import React, { useMemo, useState, useRef, useEffect } from 'react';
import * as d3 from 'd3';
import { BPlusTreeNode } from '../types';
import { SearchStep, SeparatorConvention, maxKeyOfSubtree } from '../utils/bPlusTreeLogic';

interface TreeVisualizerProps {
  root: BPlusTreeNode;
  onNodeClick?: (nodeAttributes: any) => void;
  indexType: 'primary' | 'secondary';
  /** 传入则演示一次查找：路径高亮、其余变淡 */
  search?: { steps: SearchStep[]; found: boolean; key: number; leafId: string } | null;
  /** 分隔键写法：innodb = 右侧最小键，textbook = 左侧最大键 */
  convention?: SeparatorConvention;
}

// Convert our B+ Tree Nodes to a D3 Hierarchy compatible format
const convertToHierarchy = (node: BPlusTreeNode, indexType: 'primary' | 'secondary'): any => {
  if (node.isLeaf) {
    return {
      name: `Leaf-${node.id}`,
      attributes: { id: node.id, keys: node.keys, data: node.data, isLeaf: true, nextId: node.next ? `Leaf-${node.next.id}` : null, indexType },
      children: []
    };
  }
  return {
    name: `Internal-${node.id}`,
    attributes: {
      id: node.id,
      keys: node.keys,
      // 教科书画法要显示"左侧子页最大键"（最后一格是兜底，不占键位）
      boundaryKeys: node.children.slice(0, -1).map(c => maxKeyOfSubtree(c)),
      isLeaf: false,
      indexType,
    },
    children: node.children.map(c => convertToHierarchy(c, indexType))
  };
};

const TreeVisualizer: React.FC<TreeVisualizerProps> = ({ root, onNodeClick, indexType, search, convention = 'innodb' }) => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);

  // INCREASED WIDTH to accommodate 3 keys (Order 4) without overflow
  const nodeWidth = indexType === 'primary' ? 220 : 180; 
  const nodeHeight = 60;
  // 与 flex 布局的 px-2 一致，用于把连线对准键单元
  const EDGE_PAD = 8;

  const [selectedNode, setSelectedNode] = useState<d3.HierarchyPointNode<any> | null>(null);

  // Calculate node height dynamically based on data
  const calculateNodeHeight = (node: d3.HierarchyPointNode<any>): number => {
    const isLeaf = node.data.attributes.isLeaf;
    if (!isLeaf) return 60; // Internal node has fixed height

    const keys = node.data.attributes.keys;
    const rowData = node.data.attributes.data;

    // Leaf node: base height + record rows * row height
    const baseHeight = 45;
    const recordHeight = 12;
    const padding = 10;

    let maxRecords = 0;
    rowData.forEach((records: any[]) => {
      maxRecords = Math.max(maxRecords, records.length);
    });

    return baseHeight + maxRecords * recordHeight + padding;
  };

  // D3 Layout Calculation
  const { nodes, links, leafLinks, nodeHeights } = useMemo(() => {
    if (!root) return { nodes: [], links: [], leafLinks: [], nodeHeights: new Map() };

    const hierarchyData = convertToHierarchy(root, indexType);
    const rootHierarchy = d3.hierarchy(hierarchyData);

    // Increase node separation to prevent overlap
    const treeLayout = d3.tree().nodeSize([nodeWidth + 40, nodeHeight + 80]);
    
    const treeData = treeLayout(rootHierarchy);

    // Calculate links
    const links = treeData.links();

    const leaves = treeData.leaves();
    const leavesByName = new Map(leaves.map(l => [l.data.name, l]));
    const leafLinksArr: Array<{ source: any; target: any }> = [];
    for (const leaf of leaves) {
      const nextId = leaf.data.attributes?.nextId;
      if (nextId && leavesByName.has(nextId)) {
        leafLinksArr.push({ source: leaf, target: leavesByName.get(nextId)! });
      }
    }

    const nodesArr = treeData.descendants();

    // Calculate heights for all nodes
    const heights = new Map<d3.HierarchyPointNode<any>, number>();
    nodesArr.forEach(node => {
      heights.set(node, calculateNodeHeight(node));
    });

    return { nodes: nodesArr, links, leafLinks: leafLinksArr, nodeHeights: heights };
  }, [root, indexType, nodeWidth]); // Depend on nodeWidth

  // Zoom and Auto-Fit Logic
  useEffect(() => {
    if (!wrapperRef.current || !svgRef.current || !gRef.current || nodes.length === 0) return;

    const svg = d3.select(svgRef.current);
    const g = d3.select(gRef.current);
    const { width: wrapperWidth, height: wrapperHeight } = wrapperRef.current.getBoundingClientRect();

    // 1. Calculate Tree Bounds
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    nodes.forEach((d: any) => {
      if (d.x < minX) minX = d.x;
      if (d.x > maxX) maxX = d.x;
      if (d.y < minY) minY = d.y;
      if (d.y > maxY) maxY = d.y;
    });

    const treeLeft = minX;
    const treeRight = maxX + nodeWidth;
    const treeTop = minY;
    const treeBottom = maxY + nodeHeight;

    const treeWidth = treeRight - treeLeft;
    const treeHeight = treeBottom - treeTop;

    // 2. Calculate Scale to fit
    // Add some padding
    const padding = 50;
    const availableWidth = wrapperWidth - padding * 2;
    const availableHeight = wrapperHeight - padding * 2;

    const scaleX = availableWidth / treeWidth;
    const scaleY = availableHeight / treeHeight;
    // Limit max scale to 1 (don't zoom in too much on small trees)
    const scale = Math.min(1, Math.min(scaleX, scaleY));

    // 3. Calculate Center translation
    // We want the center of the tree to be at the center of the viewport
    const treeCenterX = treeLeft + treeWidth / 2;
    const treeCenterY = treeTop + treeHeight / 2;

    // Let's stick to centering horizontally, but keeping near top vertically
    const translateX = (wrapperWidth / 2) - (treeCenterX * scale);
    const translateY = 50; // Fixed top padding 50px

    // 4. Setup Zoom Behavior
    const zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 3]) // Zoom limits
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.on('.zoom', null);
    svg.call(zoomBehavior);

    // 5. Apply Initial Transform
    const initialTransform = d3.zoomIdentity
      .translate(translateX, translateY)
      .scale(scale);

    svg.transition().duration(750).call(zoomBehavior.transform, initialTransform);

    return () => {
      svg.on('.zoom', null);
    };
  }, [nodes, nodeWidth, nodeHeight]);


  const handleNodeClick = (node: d3.HierarchyPointNode<any>) => {
    setSelectedNode(node);
    if (onNodeClick) {
        onNodeClick(node.data.attributes);
    }
  };

  // 查找演示：节点 -> 步骤序号，以及路径上的连线
  const stepIndex = new Map<string, number>();
  search?.steps.forEach((s, idx) => stepIndex.set(s.nodeId, idx + 1));
  const pathLinks = new Set<string>();
  if (search) {
    for (let i = 0; i < search.steps.length - 1; i++) {
      pathLinks.add(`${search.steps[i].nodeId}->${search.steps[i + 1].nodeId}`);
    }
  }
  const hitLeafId = search?.found ? search.leafId : null;

  return (
    <div ref={wrapperRef} className="w-full h-full bg-slate-50 border rounded-xl shadow-inner relative overflow-hidden">
       <div className="absolute top-2 left-2 text-xs text-gray-500 font-mono pointer-events-none z-10 bg-white/90 p-1.5 rounded border border-gray-200 shadow-sm backdrop-blur-sm">
         <span className="font-bold text-indigo-600">{indexType === 'primary' ? 'Clustered Index (PK: ID)' : 'Secondary Index (Key: Age)'}</span> 
         <span className="mx-2 text-gray-300">|</span> 
         <span className="text-gray-600">Page Capacity: 3 items (Order: 4)</span>
         <span className="mx-2 text-gray-300">|</span> 
         <span className="text-gray-400">Scroll to Zoom, Drag to Pan</span>
       </div>
       
       {/* SVG Container */}
       <svg ref={svgRef} className="w-full h-full block cursor-move active:cursor-grabbing">
          <defs>
            {/* Standard Gray Arrow (Internal Nodes) - Smaller */}
            <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="2" orient="auto" markerUnits="strokeWidth">
              <path d="M0,0 L0,4 L5,2 z" fill="#94a3b8" />
            </marker>
             
             {/* Standard Blue Arrow (Forward) - Smaller */}
             <marker id="arrow-blue" markerWidth="6" markerHeight="6" refX="5" refY="2" orient="auto" markerUnits="strokeWidth">
              <path d="M0,0 L0,4 L5,2 z" fill="#3b82f6" />
            </marker>

             {/* Reverse Blue Arrow (Backward) - Smaller */}
             <marker id="arrow-blue-reverse" markerWidth="6" markerHeight="6" refX="0" refY="2" orient="auto" markerUnits="strokeWidth">
              <path d="M5,0 L5,4 L0,2 z" fill="#3b82f6" />
            </marker>

             {/* Selected Arrow - Smaller */}
             <marker id="arrow-selected" markerWidth="6" markerHeight="6" refX="5" refY="2" orient="auto" markerUnits="strokeWidth">
              <path d="M0,0 L0,4 L5,2 z" fill="#8b5cf6" />
            </marker>
          </defs>

          {/* Group that gets Transformed */}
          <g ref={gRef}>
              {/* Tree Links (Parent to Child) */}
              {links.map((link, i) => {
                // 连线必须从"分隔键"底下出发，否则 n 个键 + n+1 个子页的对应关系看不出来。
                // 规则与 searchLeafNode() 一致：key >= 分隔键 走右侧，首键之前走最左子页。
                // 也就是说 children[i] (i>=1) 的分隔键是 keys[i-1]，children[0] 没有分隔键。
                const childIdx = link.source.children
                  ? link.source.children.indexOf(link.target)
                  : -1;
                const attrs = link.source.data.attributes;
                const keyCount = attrs.keys.length;
                const shownKeys: number[] =
                  convention === 'textbook'
                    ? (attrs.boundaryKeys as (number | undefined)[]).filter((k): k is number => k !== undefined)
                    : (attrs.keys as number[]);
                const innerWidth = nodeWidth - EDGE_PAD * 2;
                const cellWidth = keyCount > 0 ? innerWidth / keyCount : 0;

                // innodb：从对应分隔键格下方出发；textbook：从两格之间的缝隙出发（右侧是子页）
                let sourceX: number;
                if (convention === 'textbook') {
                  if (childIdx <= 0) sourceX = link.source.x + EDGE_PAD * 0.5;
                  else if (childIdx >= keyCount) sourceX = link.source.x + nodeWidth - EDGE_PAD * 0.5;
                  else sourceX = link.source.x + EDGE_PAD + childIdx * cellWidth;
                } else if (childIdx > 0 && keyCount > 0) {
                  sourceX = link.source.x + EDGE_PAD + (childIdx - 0.5) * cellWidth;
                } else if (childIdx === 0) {
                  sourceX = link.source.x + EDGE_PAD * 0.5;
                } else {
                  sourceX = link.source.x + nodeWidth / 2;
                }

                const sourceY = link.source.y + nodeHeight;
                const targetX = link.target.x + nodeWidth / 2;
                const targetY = link.target.y;
                
                // Check if this link should be highlighted
                const isHighlighted = selectedNode && link.source === selectedNode;
                const onPath = pathLinks.has(`${attrs.id}->${link.target.data.attributes.id}`);

                const strokeColor = onPath ? "#7c3aed" : isHighlighted ? "#8b5cf6" : "#cbd5e1"; // Violet if highlighted, else Slate
                const strokeW = onPath ? "3.5" : isHighlighted ? "3" : "2";
                const marker = onPath || isHighlighted ? "url(#arrow-selected)" : "url(#arrow)";
                
                // Bezier curve for smooth connection
                const d = `M${sourceX},${sourceY} C${sourceX},${(sourceY+targetY)/2} ${targetX},${(sourceY+targetY)/2} ${targetX},${targetY}`;

                // 子页取值范围，直接标在这根线的起点旁
                let rangeLabel = '';
                if (shownKeys.length > 0) {
                  if (convention === 'textbook') {
                    if (childIdx <= 0) rangeLabel = `≤ ${shownKeys[0]}`;
                    else if (childIdx >= shownKeys.length) rangeLabel = `> ${shownKeys[shownKeys.length - 1]}`;
                    else rangeLabel = `> ${shownKeys[childIdx - 1]} 且 ≤ ${shownKeys[childIdx]}`;
                  } else if (childIdx === 0) rangeLabel = `< ${shownKeys[0]}`;
                  else if (childIdx >= shownKeys.length) rangeLabel = `≥ ${shownKeys[shownKeys.length - 1]}`;
                  else rangeLabel = `${shownKeys[childIdx - 1]} – < ${shownKeys[childIdx]}`;
                }

                return (
                  <g key={`link-${i}`}>
                    <path d={d} fill="none" stroke={strokeColor} strokeWidth={strokeW} markerEnd={marker} className="transition-all duration-300" />
                    {rangeLabel && (
                      <text
                        x={sourceX}
                        y={sourceY + 13}
                        textAnchor="middle"
                        fontSize="9"
                        fontFamily="ui-monospace, monospace"
                        fill={onPath ? '#6d28d9' : '#94a3b8'}
                        fontWeight={onPath ? 'bold' : 'normal'}
                      >
                        {rangeLabel}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Leaf Node Links (Doubly Linked List) */}
              {leafLinks.map((link, i) => {
                const sourceHeight = nodeHeights.get(link.source) || 60;
                const targetHeight = nodeHeights.get(link.target) || 60;
                const sourceX = link.source.x + nodeWidth;
                const sourceY = link.source.y + sourceHeight / 2;
                const targetX = link.target.x;
                const targetY = link.target.y + targetHeight / 2;
                
                const d = `M${sourceX},${sourceY} L${targetX},${targetY}`;
                
                return (
                    <path 
                        key={`leaf-link-${i}`} 
                        d={d} 
                        fill="none" 
                        stroke="#3b82f6" 
                        strokeWidth="1.5" 
                        strokeDasharray="3,3" 
                        markerStart="url(#arrow-blue-reverse)" 
                        markerEnd="url(#arrow-blue)" 
                    />
                )
              })}

               {/* Nodes */}
               {nodes.map((node: any, i) => {
                 const isLeaf = node.data.attributes.isLeaf;
                 const keys = node.data.attributes.keys;
                 const rowData = node.data.attributes.data;
                 const idxType = node.data.attributes.indexType;
                 const currentHeight = nodeHeights.get(node) || 60;

                 const isSelected = selectedNode === node;
                 const isChildOfSelected = selectedNode && node.parent === selectedNode;

                 const nodeId = node.data.attributes.id as string;
                 const step = stepIndex.get(nodeId);
                 const onPath = step !== undefined;
                 const isHitLeaf = hitLeafId === nodeId;

                 let rectFill = isLeaf ? "#ecfdf5" : "#eff6ff";
                 let rectStroke = isLeaf ? "#10b981" : "#3b82f6";
                 let rectStrokeWidth = "2";

                 if (onPath) {
                     rectStroke = isHitLeaf ? "#059669" : "#7c3aed";
                     rectFill = isHitLeaf ? "#d1fae5" : "#f5f3ff";
                     rectStrokeWidth = "3.5";
                 } else if (isSelected) {
                     rectStroke = "#f59e0b"; // Amber-500
                     rectFill = "#fffbeb";   // Amber-50
                     rectStrokeWidth = "3";
                 } else if (isChildOfSelected) {
                     rectStroke = "#8b5cf6"; // Violet-500
                     rectFill = "#f5f3ff";   // Violet-50
                     rectStrokeWidth = "3";
                 }

                 // 指针长在节点里：innodb 挂在键格下方，textbook 挂在格与格之间的缝上
                 const keyCount = keys.length;
                 const cellW = keyCount > 0 ? (nodeWidth - EDGE_PAD * 2) / keyCount : 0;
                 const pointerXs: number[] = [];
                 if (!isLeaf) {
                   if (convention === 'textbook') {
                     pointerXs.push(EDGE_PAD * 0.5);
                     for (let ci = 1; ci < keyCount; ci++) pointerXs.push(EDGE_PAD + ci * cellW);
                     pointerXs.push(nodeWidth - EDGE_PAD * 0.5);
                   } else {
                     pointerXs.push(EDGE_PAD * 0.5);
                     for (let ci = 0; ci < keyCount; ci++) pointerXs.push(EDGE_PAD + (ci + 0.5) * cellW);
                   }
                 }

                 return (
                   <g
                     key={`node-${i}`}
                     transform={`translate(${node.x},${node.y})`}
                     onClick={(e) => { e.stopPropagation(); handleNodeClick(node); }}
                     opacity={search && !onPath ? 0.35 : 1}
                     className="cursor-pointer hover:opacity-90 transition-opacity"
                   >
                     {/* Node Container */}
                     <rect
                       width={nodeWidth}
                       height={currentHeight}
                       rx={8}
                       fill={rectFill}
                       stroke={rectStroke}
                       strokeWidth={rectStrokeWidth}
                       className="shadow-sm transition-all duration-300"
                     />

                     {/* 内部页：键下方的小指针 */}
                     {pointerXs.map((px, pi) => (
                       <path
                         key={`ptr-${pi}`}
                         d={`M${px - 4},${currentHeight - 7} L${px},${currentHeight - 1} L${px + 4},${currentHeight - 7} Z`}
                         fill={onPath ? '#7c3aed' : '#93c5fd'}
                       />
                     ))}

                     {/* 查找步序 */}
                     {step !== undefined && (
                       <g>
                         <circle cx={nodeWidth - 12} cy={12} r={8.5} fill={isHitLeaf ? '#059669' : '#7c3aed'} />
                         <text x={nodeWidth - 12} y={16} textAnchor="middle" fontSize="10" fontWeight="bold" fill="#fff">
                           {step}
                         </text>
                       </g>
                     )}

                     {/* Node Label (Top Left) */}
                     <text x="5" y="15" fontSize="10" fill={isLeaf ? "#059669" : "#1d4ed8"} fontWeight="bold">
                       {isLeaf ? "Leaf Page" : "Index Page"}
                     </text>

                     {/* Content Container */}
                     <foreignObject x="0" y="20" width={nodeWidth} height={currentHeight - 20} style={{pointerEvents: 'none'}}>
                         <div className="flex h-full items-center justify-around px-2">
                             {keys.map((k: number, ki: number) => (
                                 <div key={ki} className="flex flex-col items-center flex-1 min-w-0 px-0.5">
                                     <div className={`w-full px-1 py-1 rounded text-xs font-mono font-bold border text-center ${isLeaf ? 'bg-white border-green-200 text-green-700' : 'bg-white border-blue-200 text-blue-700'}`}>
                                         {/* The Key Value（内部页在教科书画法下显示左侧子页的最大键） */}
                                         <span className={`text-sm block ${!isLeaf && convention === 'textbook' ? 'opacity-90' : ''}`}>
                                             {!isLeaf && convention === 'textbook'
                                                 ? (node.data.attributes.boundaryKeys?.[ki] ?? k)
                                                 : k}
                                         </span>

                                         {/* The "Payload" for Leaf Nodes - Support multiple records */}
                                         {isLeaf && rowData && rowData[ki] && rowData[ki].length > 0 && (
                                             <div className="text-[9px] font-normal text-gray-500 border-t border-gray-100 mt-1 pt-0.5 whitespace-pre">
                                                 {rowData[ki].map((r: any) =>
                                                     idxType === 'primary'
                                                     ? `${r.name}, ${r.age}`
                                                     : `PK: ${r.id}`
                                                 ).join('\n')}
                                             </div>
                                         )}
                                     </div>
                                 </div>
                             ))}
                             {keys.length === 0 && <span className="text-xs text-gray-400 italic">Empty</span>}
                         </div>
                     </foreignObject>
                   </g>
                 );
               })}
          </g>
       </svg>
    </div>
  );
};

export default TreeVisualizer;
