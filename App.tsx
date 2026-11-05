import React, { useState, useEffect, useMemo } from 'react';
import { BPlusTree, SeparatorConvention } from './utils/bPlusTreeLogic';
import { TableRow, AIConfig, DEFAULT_AI_CONFIG, AIProvider } from './types';
import TreeVisualizer from './components/TreeVisualizer';
import DataTable from './components/DataTable';
import SettingsModal from './components/SettingsModal';
import Toast, { ToastItem, ToastVariant } from './components/Toast';
import { AIService } from './services/aiService';
import { Bot, Settings, Info, Sparkles, MousePointerClick, Layers, FileCode, Database } from 'lucide-react';

const INITIAL_DATA: TableRow[] = [
    { id: 5, name: 'Alice', age: 25 },
    { id: 10, name: 'Bob', age: 30 },
    { id: 15, name: 'Charlie', age: 22 },
];

type ViewMode = 'clustered' | 'secondary' | 'ddl';

function App() {
    const [data, setData] = useState<TableRow[]>(INITIAL_DATA);
    const [viewMode, setViewMode] = useState<ViewMode>('clustered');

    // Two trees: one for PK (ID), one for Secondary (Age)
    const pkTree = useMemo(() => BPlusTree.fromRows(data, r => r.id, { uniqueKeys: true }), [data]);
    const secTree = useMemo(() => BPlusTree.fromRows(data, r => r.age, { uniqueKeys: false }), [data]);

    // 查找演示
    const [searchInput, setSearchInput] = useState('');
    const [searchKey, setSearchKey] = useState<number | null>(null);
    const [convention, setConvention] = useState<SeparatorConvention>('innodb');
    const [revealed, setRevealed] = useState(0);
    const activeTree = viewMode === 'secondary' ? secTree : pkTree;
    const searchTrace = useMemo(
        () => (searchKey === null ? null : activeTree.searchPath(searchKey, convention)),
        [activeTree, searchKey, convention]
    );

    // 逐步回放，每步 450ms
    useEffect(() => {
        if (!searchTrace) {
            setRevealed(0);
            return;
        }
        setRevealed(1);
        const timers: number[] = [];
        for (let i = 2; i <= searchTrace.steps.length; i++) {
            timers.push(window.setTimeout(() => setRevealed(i), (i - 1) * 450));
        }
        return () => timers.forEach(t => window.clearTimeout(t));
    }, [searchTrace]);

    const visibleSteps = searchTrace ? searchTrace.steps.slice(0, Math.max(revealed, 1)) : [];
    const traceDone = !searchTrace || revealed >= searchTrace.steps.length;
    const displayTrace = searchTrace
        ? { steps: visibleSteps, found: traceDone && searchTrace.found, key: searchTrace.key, leafId: traceDone ? searchTrace.leafId : '' }
        : null;

    // AI State
    const [aiConfig, setAiConfig] = useState<AIConfig>(DEFAULT_AI_CONFIG[AIProvider.SILICONFLOW]);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [aiResponse, setAiResponse] = useState<string>('');
    const [isThinking, setIsThinking] = useState(false);
    const [toasts, setToasts] = useState<ToastItem[]>([]);

    // Load AI Config from LocalStorage on mount
    useEffect(() => {
        const savedConfig = localStorage.getItem('innodb_viz_ai_config');
        if (savedConfig) {
            try {
                setAiConfig(JSON.parse(savedConfig));
            } catch (e) {
                console.error("Failed to parse saved AI config");
            }
        }
    }, []);

    const saveAiConfig = (newConfig: AIConfig) => {
        setAiConfig(newConfig);
        localStorage.setItem('innodb_viz_ai_config', JSON.stringify(newConfig));
        setIsSettingsOpen(false);
    };

    const dismissToast = (id: string) => {
        setToasts(current => current.filter(t => t.id !== id));
    };

    const pushToast = (message: string, variant: ToastVariant = 'info') => {
        const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
        setToasts(current => [...current, { id, message, variant }]);
        window.setTimeout(() => {
            dismissToast(id);
        }, 4500);
    };

    const requireApiKeyOrPrompt = (message: string) => {
        if (aiConfig.provider !== AIProvider.OLLAMA && (!aiConfig.apiKey || aiConfig.apiKey.trim() === '')) {
            setIsSettingsOpen(true);
            pushToast(message, 'error');
            return false;
        }
        return true;
    };

    const handleAddRow = (row: TableRow) => {
        if (data.some(r => r.id === row.id)) {
            pushToast('ID 必须唯一。', 'error');
            return;
        }
        // Simple check for unique age to keep visualization clean
        if (data.some(r => r.age === row.age)) {
            // Logic to handle duplicate ages if needed
        }
        setData([...data, row]);
    };

    const handleDeleteRow = (id: number) => {
        setData(data.filter(r => r.id !== id));
    };

    const handleAskAI = async () => {
        // 1. Check if Key exists locally
        if (!requireApiKeyOrPrompt('请先配置您的 API Key 以使用 AI 功能。\n您的 Key 仅存储在本地浏览器中。')) return;

        setIsThinking(true);
        setAiResponse('');

        const isPrimary = viewMode === 'clustered';
        const activeTree = isPrimary ? pkTree : secTree;

        try {
            const service = new AIService(aiConfig);
            const treeJson = JSON.stringify(activeTree.root, (key, value) => {
                if (key === 'next') {
                    return value ? { id: value.id, isLeaf: value.isLeaf } : null;
                }
                if (key === 'parent') {
                    return undefined; // Ignore parent reference to avoid circular references
                }
                return value;
            }, 2);

            const contextStr = viewMode === 'ddl'
                ? "当前用户正在查看 DDL 语句页面。"
                : `当前查看的是: ${isPrimary ? '聚簇索引 (Clustered Index, Key=ID)' : '非聚簇索引 (Secondary Index, Key=Age)'}\nTree Structure:\n${treeJson}`;

            const prompt = viewMode === 'ddl'
                ? "请解释一下页面上展示的 CREATE TABLE 和 CREATE INDEX 语句的含义，以及它们在 MySQL InnoDB 中是如何工作的。"
                : "请解释当前的B+树结构，指出根节点是什么，叶子节点有哪些，以及它们是如何链接的。特别说明一下这种索引类型的特点。";

            const answer = await service.generateExplanation(prompt, contextStr);
            setAiResponse(answer);
        } catch (e: any) {
            if (e.message === "MISSING_API_KEY") {
                setIsSettingsOpen(true);
                setAiResponse("请配置 API Key。");
            } else {
                setAiResponse("请求出错，请检查设置中的 API Key 配置是否正确。");
            }
        } finally {
            setIsThinking(false);
        }
    };

    const handleNodeClick = async (nodeAttrs: any) => {
        if (nodeAttrs.isLeaf) {
            // 1. Check if Key exists locally
            if (!requireApiKeyOrPrompt('请先配置您的 API Key 以使用 AI 功能。')) return;

            setIsThinking(true);
            setAiResponse("正在分析选中的叶子节点数据...");

            try {
                const service = new AIService(aiConfig);
                const nodeDataStr = JSON.stringify(nodeAttrs, null, 2);
                const isPrimary = nodeAttrs.indexType === 'primary';

                const prompt = `
              用户点击了 ${isPrimary ? '聚簇索引 (Primary Key)' : '非聚簇索引 (Secondary Index)'} 的一个叶子节点。
              数据: ${nodeAttrs.keys.join(', ')}
              
              请解释：
              1. 为什么这些数据被聚集在这个节点？
              2. ${isPrimary ? '为什么聚簇索引的叶子节点包含完整行数据？' : '为什么非聚簇索引的叶子节点只包含索引键和主键(PK)？什么是回表(Row Lookup)？'}
              3. 这种结构对查询性能的影响。
            `;

                const answer = await service.generateExplanation(prompt, `选中的叶子节点详情:\n${nodeDataStr}`);
                setAiResponse(answer);
            } catch (e: any) {
                if (e.message === "MISSING_API_KEY") {
                    setIsSettingsOpen(true);
                    setAiResponse("请配置 API Key。");
                } else {
                    setAiResponse("无法分析该节点。请检查 API 配置。");
                }
            } finally {
                setIsThinking(false);
            }
        }
    };

    return (
        <div className="min-h-screen flex flex-col text-gray-800 font-sans">
            <Toast toasts={toasts} onDismiss={dismissToast} />
            {/* Header */}
            <header className="bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center shadow-sm z-10 sticky top-0">
                <div className="flex items-center gap-3">
                    <div className="bg-indigo-600 p-2 rounded-lg text-white shadow-md">
                        <DatabaseIcon className="w-6 h-6" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold text-gray-900 tracking-tight">InnoDB B+ Tree 索引可视化</h1>
                        <p className="text-xs text-gray-500 font-medium">MySQL Index Simulation Engine</p>
                    </div>
                </div>

                {/* Navigation Tabs */}
                <div className="flex bg-gray-100 p-1 rounded-lg">
                    <button
                        onClick={() => setViewMode('clustered')}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${viewMode === 'clustered' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                        <Database className="w-4 h-4" />
                        聚簇索引 (PK)
                    </button>
                    <button
                        onClick={() => setViewMode('secondary')}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${viewMode === 'secondary' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                        <Layers className="w-4 h-4" />
                        非聚簇索引 (Age)
                    </button>
                    <button
                        onClick={() => setViewMode('ddl')}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${viewMode === 'ddl' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                        <FileCode className="w-4 h-4" />
                        DDL & Index
                    </button>
                </div>

                <div className="flex items-center gap-3">
                    <div className="hidden md:flex flex-col items-end mr-2">
                        <span className="text-xs font-medium text-gray-600">Model: {aiConfig.provider}</span>
                        <span className="text-[10px] text-gray-400 max-w-[100px] truncate">{aiConfig.model}</span>
                    </div>
                    <button
                        onClick={() => setIsSettingsOpen(true)}
                        className={`p-2 rounded-lg transition-all ${(!aiConfig.apiKey && aiConfig.provider !== 'OLLAMA') ? 'text-red-500 bg-red-50 animate-pulse' : 'text-gray-500 hover:text-indigo-600 hover:bg-indigo-50'}`}
                        title="AI 设置"
                    >
                        <Settings className="w-5 h-5" />
                    </button>
                </div>
            </header>

            {/* Main Content */}
            <main className="flex-1 overflow-hidden flex flex-col lg:flex-row bg-slate-50/50">

                {/* Left Sidebar: Data & Controls */}
                <aside className="w-full lg:w-80 bg-white p-4 border-r border-gray-200 overflow-y-auto shrink-0 flex flex-col gap-4 shadow-[4px_0_24px_rgba(0,0,0,0.02)] z-0">
                    <DataTable
                        data={data}
                        onAdd={handleAddRow}
                        onDelete={handleDeleteRow}
                    />

                    <div className="bg-gradient-to-br from-indigo-600 to-violet-600 rounded-xl p-5 text-white shadow-lg ring-1 ring-black/5">
                        <div className="flex items-start gap-3 mb-4">
                            <div className="p-2 bg-white/10 rounded-lg backdrop-blur-sm">
                                <Bot className="w-6 h-6 text-indigo-50" />
                            </div>
                            <div>
                                <h3 className="font-bold text-lg">AI 助教</h3>
                                <p className="text-xs text-indigo-100 opacity-90 mt-1">
                                    {viewMode === 'clustered' ? '解释主键 B+ 树结构' : viewMode === 'secondary' ? '解释辅助索引与回表' : '解释 SQL 语句含义'}
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={handleAskAI}
                            disabled={isThinking}
                            className="w-full py-2.5 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 active:scale-[0.98]"
                        >
                            {isThinking ? (
                                <div className="w-4 h-4 border-2 border-white/50 border-t-white rounded-full animate-spin" />
                            ) : (
                                <Sparkles className="w-4 h-4 text-amber-300" />
                            )}
                            {isThinking ? "思考中..." : "开始分析"}
                        </button>
                        {(!aiConfig.apiKey && aiConfig.provider !== 'OLLAMA') && (
                            <p className="text-[10px] text-center mt-2 text-red-200 bg-red-900/20 py-1 rounded">
                                * 请点击右上角设置 API Key
                            </p>
                        )}
                    </div>

                    {/* AI Response Area */}
                    <div className="flex-1 min-h-[200px] bg-gray-50 rounded-xl border border-gray-200 p-4 text-sm leading-relaxed overflow-y-auto max-h-[500px] shadow-inner">
                        {aiResponse ? (
                            <>
                                <h4 className="font-bold text-gray-800 mb-3 flex items-center gap-2 sticky top-0 bg-gray-50 pb-2 border-b border-gray-200">
                                    <Info className="w-4 h-4 text-indigo-500" />
                                    AI 分析结果:
                                </h4>
                                <div className="prose prose-sm prose-indigo text-gray-600 whitespace-pre-wrap font-medium">
                                    {aiResponse}
                                </div>
                            </>
                        ) : (
                            <div className="h-full flex flex-col items-center justify-center text-gray-400 text-center p-4">
                                <MousePointerClick className="w-10 h-10 mb-3 opacity-30" />
                                <p className="text-xs uppercase tracking-wide font-semibold opacity-60">
                                    {viewMode === 'ddl' ? '点击分析按钮解释 SQL' : '点击右侧节点或分析按钮'}
                                </p>
                            </div>
                        )}
                    </div>
                </aside>

                {/* Right Area: Content Switcher */}
                <section className="flex-1 p-4 lg:p-8 overflow-hidden flex flex-col bg-slate-50 relative">

                    {viewMode === 'ddl' ? (
                        <div className="w-full max-w-4xl mx-auto bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                            <div className="bg-gray-800 px-4 py-3 border-b border-gray-700 flex items-center gap-2">
                                <div className="flex gap-1.5">
                                    <div className="w-3 h-3 rounded-full bg-red-500"></div>
                                    <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                                    <div className="w-3 h-3 rounded-full bg-green-500"></div>
                                </div>
                                <span className="ml-4 text-xs font-mono text-gray-400">schema.sql</span>
                            </div>
                            <div className="p-6 bg-[#1e1e1e] text-gray-300 font-mono text-sm overflow-auto">
                                <pre>{`-- 创建用户表 (聚簇索引结构由 PRIMARY KEY 决定)
CREATE TABLE users (
    id INT NOT NULL,
    name VARCHAR(255),
    age INT,
    PRIMARY KEY (id)  -- 聚簇索引 (Clustered Index)
) ENGINE=InnoDB;

-- 创建辅助索引 (B+树叶子节点存储 age 和 id)
CREATE INDEX idx_age ON users(age); -- 非聚簇索引 (Secondary Index)

-- 当前数据插入语句:
${data.map(r => `INSERT INTO users (id, name, age) VALUES (${r.id}, '${r.name}', ${r.age});`).join('\n')}
`}</pre>
                            </div>
                        </div>
                    ) : (
                        <>
                            <div className="flex-1 min-h-[400px]">
                                {viewMode === 'clustered' ? (
                                    <TreeVisualizer root={pkTree.root} onNodeClick={handleNodeClick} indexType="primary" search={displayTrace} convention={convention} />
                                ) : (
                                    <TreeVisualizer root={secTree.root} onNodeClick={handleNodeClick} indexType="secondary" search={displayTrace} convention={convention} />
                                )}
                            </div>

                            {/* 查找演示：输入键 -> 逐步回放 */}
                            <div className="mt-3 mx-auto w-fit flex items-center gap-2 bg-white px-3 py-2 rounded-full shadow-sm border border-gray-100">
                                <span className="text-xs text-gray-500">查一个键，看它怎么走：</span>
                                <input
                                    type="number"
                                    value={searchInput}
                                    onChange={(e) => setSearchInput(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && searchInput !== '') setSearchKey(Number(searchInput));
                                        if (e.key === 'Escape') { setSearchKey(null); setSearchInput(''); }
                                    }}
                                    placeholder={viewMode === 'secondary' ? 'age' : 'id'}
                                    className="w-20 rounded-lg border border-gray-300 px-2 py-1 text-xs font-mono focus:ring-2 focus:ring-indigo-500"
                                />
                                <button
                                    onClick={() => searchInput !== '' && setSearchKey(Number(searchInput))}
                                    className="text-xs px-3 py-1 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
                                >
                                    走一遍
                                </button>
                                {searchTrace && !traceDone && (
                                    <button
                                        onClick={() => setRevealed(searchTrace.steps.length)}
                                        className="text-xs px-3 py-1 rounded-lg border border-indigo-300 text-indigo-600 hover:bg-indigo-50"
                                    >
                                        跳过
                                    </button>
                                )}
                                <button
                                    onClick={() => { setSearchKey(null); setSearchInput(''); }}
                                    className="text-xs px-3 py-1 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50"
                                >
                                    清除
                                </button>
                                <span className="w-px h-4 bg-gray-200 mx-1" />
                                <span className="text-xs text-gray-400">画法</span>
                                <button
                                    onClick={() => setConvention('innodb')}
                                    className={`text-xs px-2 py-1 rounded-lg border ${convention === 'innodb' ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
                                >
                                    InnoDB
                                </button>
                                <button
                                    onClick={() => setConvention('textbook')}
                                    className={`text-xs px-2 py-1 rounded-lg border ${convention === 'textbook' ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
                                >
                                    教科书
                                </button>
                            </div>

                            {searchTrace && (
                                <div className="mt-2 mx-auto max-w-2xl text-xs font-mono bg-white border rounded-xl px-4 py-2 shadow-sm">
                                    {visibleSteps.map((s, i) => (
                                        <div key={i} className="flex gap-2 py-0.5">
                                            <span className="text-indigo-600 font-bold shrink-0">{i + 1}.</span>
                                            <span className="text-gray-400 shrink-0">在 [{s.keys.join(', ')}] 里</span>
                                            <span className={s.nextChild === null ? (searchTrace.found ? 'text-green-600 font-bold' : 'text-red-500 font-bold') : 'text-gray-700'}>
                                                {s.text}
                                            </span>
                                        </div>
                                    ))}
                                    {!traceDone && <div className="py-0.5 text-gray-300">…</div>}
                                </div>
                            )}

                            <div className="mt-6 flex gap-8 justify-center text-sm text-gray-500 bg-white py-3 px-6 rounded-full shadow-sm border border-gray-100 mx-auto w-fit">
                                <div className="flex items-center gap-2">
                                    <span className="w-3 h-3 rounded-full bg-blue-100 border border-blue-500 block"></span>
                                    <span>非叶子节点 (Pages)</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="w-3 h-3 rounded-full bg-green-50 border border-green-500 block"></span>
                                    <span>叶子节点 (Data)</span>
                                </div>
                                {viewMode === 'secondary' && (
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                                            Leaf Content: Key(Age) + PK(ID)
                                        </span>
                                    </div>
                                )}
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-slate-600 bg-slate-100 px-2 py-1 rounded border border-slate-200 leading-snug">
                                        {convention === 'innodb'
                                            ? 'InnoDB 画法：内部页存的是右侧子页的最小键，key ≥ 该键走右边。3 同时出现在根和叶子里，是同一个键的两份。'
                                            : '教科书画法：内部页存的是左侧子页的最大键，key ≤ 该键走左边，大于最后一个走最右。结构一样，只是等值归属反过来。'}
                                    </span>
                                </div>
                            </div>
                        </>
                    )}
                </section>
            </main>

            {/* Settings Modal */}
            <SettingsModal
                isOpen={isSettingsOpen}
                onClose={() => setIsSettingsOpen(false)}
                config={aiConfig}
                onSave={saveAiConfig}
            />
        </div>
    );
}

// Simple Icon Component
const DatabaseIcon = ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
        <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
    </svg>
);

export default App;
