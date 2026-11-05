import React, { useState } from 'react';
import { X, Settings as SettingsIcon, Save, ShieldCheck } from 'lucide-react';
import { AIConfig, AIProvider, DEFAULT_AI_CONFIG } from '../types';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: AIConfig;
  onSave: (config: AIConfig) => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, config, onSave }) => {
  const [localConfig, setLocalConfig] = useState<AIConfig>(config);

  if (!isOpen) return null;

  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newProvider = e.target.value as AIProvider;
    // When switching, load defaults for that provider to help the user
    setLocalConfig({
        ...DEFAULT_AI_CONFIG[newProvider],
        apiKey: localConfig.apiKey // Preserve key if user wants, or clear it. Let's start fresh or keep.
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-[fadeIn_0.2s_ease-out]">
        <div className="flex justify-between items-center p-4 border-b border-gray-100 bg-gray-50">
          <div className="flex items-center gap-2">
            <SettingsIcon className="w-5 h-5 text-indigo-600" />
            <h2 className="font-semibold text-gray-800">AI 设置 (Setup AI)</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          
          <div className="bg-blue-50 text-blue-800 p-3 rounded-lg text-xs flex items-start gap-2 border border-blue-100">
             <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
             <p>
               <strong>安全提示：</strong> 您的 API Key 仅保存在您当前浏览器的 LocalStorage 中，直接用于请求 AI 服务，<strong>不会</strong>被发送到本项目及其开发者的服务器。
             </p>
          </div>

          {/* Provider Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">AI 模型服务商</label>
            <select
              value={localConfig.provider}
              onChange={handleProviderChange}
              className="w-full rounded-lg border-gray-300 border p-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            >
              <option value={AIProvider.GEMINI}>Google Gemini (推荐)</option>
              <option value={AIProvider.SILICONFLOW}>OpenAI 兼容接口（本地网关 / 硅基流动）</option>
              <option value={AIProvider.OLLAMA}>Ollama (本地)</option>
            </select>
          </div>

          {/* API Key */}
          {localConfig.provider !== AIProvider.OLLAMA && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">API Key <span className="text-red-500">*</span></label>
              <input
                type="password"
                value={localConfig.apiKey}
                onChange={(e) => setLocalConfig({ ...localConfig, apiKey: e.target.value })}
                placeholder={localConfig.provider === AIProvider.GEMINI ? "输入 Gemini API Key" : "sk-..."}
                className="w-full rounded-lg border-gray-300 border p-2 text-sm focus:ring-2 focus:ring-indigo-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                {localConfig.provider === AIProvider.GEMINI 
                  ? "需要有效的 Gemini API Key。" 
                  : "填 OpenAI 兼容服务的 Token。Base URL 留 /v1 即走本机代理。"}
              </p>
            </div>
          )}

          {/* Base URL */}
          <div>
             <label className="block text-sm font-medium text-gray-700 mb-1">Base URL</label>
             <input
                type="text"
                value={localConfig.baseUrl}
                onChange={(e) => setLocalConfig({ ...localConfig, baseUrl: e.target.value })}
                className="w-full rounded-lg border-gray-300 border p-2 text-sm text-gray-600 bg-gray-50"
             />
          </div>

          {/* Model Name */}
          <div>
             <label className="block text-sm font-medium text-gray-700 mb-1">模型名称</label>
             <input
                type="text"
                value={localConfig.model}
                onChange={(e) => setLocalConfig({ ...localConfig, model: e.target.value })}
                className="w-full rounded-lg border-gray-300 border p-2 text-sm"
             />
          </div>

        </div>

        <div className="p-4 bg-gray-50 border-t border-gray-100 flex justify-end">
          <button
            onClick={() => onSave(localConfig)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium shadow-sm"
          >
            <Save className="w-4 h-4" />
            保存并在本地缓存
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;