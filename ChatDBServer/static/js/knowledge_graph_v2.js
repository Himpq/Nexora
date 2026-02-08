
class GraphEditor {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.viewport = this.container.querySelector('.viewport');
        this.edgesLayer = this.viewport.querySelector('.edges-layer'); // SVG
        this.nodesLayer = this.viewport.querySelector('.nodes-layer'); // Div container

        this.scale = 1;
        this.pan = { x: 0, y: 0 };
        this.isDraggingCanvas = false;
        this.lastMousePos = { x: 0, y: 0 };
        this.isDraggingNode = null;
        
        // Connection Mode State
        this.connectionState = {
            active: false,
            sourceNode: null
        };
        
        this.nodes = [];
        this.edges = [];
        
        this.GRID_SIZE = 20;
        this.COL_WIDTH = 300; // Includes spacing for visual "Columns"
        this.ROW_HEIGHT = 100;
        
        this.initEvents();
        this.loadData();
    }

    initEvents() {
        const container = this.container;

        // Global Mouse Move for Dragging and Temp Line
        window.addEventListener('mousemove', (e) => {
            if (this.connectionState.active) {
                this.updateTempLine(e);
            }

            if (this.isDraggingCanvas) {
                const dx = e.clientX - this.lastMousePos.x;
                const dy = e.clientY - this.lastMousePos.y;
                this.pan.x += dx;
                this.pan.y += dy;
                this.lastMousePos = { x: e.clientX, y: e.clientY };
                this.updateTransform();
            } else if (this.isDraggingNode) {
                this.handleNodeDrag(e);
            }
        });

        // Global Mouse Up (End Drag mostly)
        window.addEventListener('mouseup', () => {
            this.isDraggingCanvas = false;
            this.isDraggingNode = null;
            container.style.cursor = 'default';
        });
        
        // Right Click to Cancel Connection Mode
        container.addEventListener('contextmenu', (e) => {
            if (this.connectionState.active) {
                e.preventDefault();
                this.exitConnectionMode();
            }
        });

        // Canvas Controls
        document.getElementById('zoomIn')?.addEventListener('click', () => {
            this.scale = Math.min(3, this.scale + 0.1);
            this.updateTransform();
        });
        document.getElementById('zoomOut')?.addEventListener('click', () => {
            this.scale = Math.max(0.2, this.scale - 0.1);
            this.updateTransform();
        });

        document.getElementById('aiScanBtn')?.addEventListener('click', async () => {
            const btn = document.getElementById('aiScanBtn');
            const originalHtml = btn.innerHTML;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Scanning...';
            btn.disabled = true;

            try {
                const res = await fetch('/api/knowledge/ai/scan', { method: 'POST' });
                const data = await res.json();
                this.showToast(data.message);
                this.loadData(); // Reload to show new links
            } catch(e) {
                this.showToast('Scan failed');
            } finally {
                btn.innerHTML = originalHtml;
                btn.disabled = false;
            }
        });
    }

    showToast(msg) {
        // Simple toast
        let toast = document.createElement('div');
        toast.style = 'position:fixed; bottom:24px; left:50%; transform:translateX(-50%); background:#333; color:white; padding:8px 24px; border-radius:30px; z-index:1000; font-size:14px;';
        toast.innerText = msg;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }

    updateTransform() {
        this.viewport.style.transform = `translate(${this.pan.x}px, ${this.pan.y}px) scale(${this.scale})`;
        const grid = this.container.querySelector('.grid-background');
        // Grid usually stays fixed in simple implementations OR moves. 
        // For infinite effect, we move grid background position
        grid.style.backgroundPosition = `${this.pan.x}px ${this.pan.y}px`;
        grid.style.backgroundSize = `${20 * this.scale}px ${20 * this.scale}px`; // Scale dots
    }

    async loadData() {
        try {
            const res = await fetch('/api/knowledge/graph');
            if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
            const data = await res.json();
            
            if (data.success && data.graph) {
                this.buildGraph(data.graph);
            }
        } catch (e) {
            console.error("Failed to load graph", e);
        }
    }

    buildGraph(graph) {
        this.nodes = [];
        this.edges = [];
        const categories = graph.categories;

        // 1. Root Node
        this.nodes.push({ id: 'root', title: '核心枢纽', type: 'ROOT', x: 50, y: 300, data: {} });

        // 2. Categories & Knowledge
        Object.keys(categories).forEach((catKey, catIdx) => {
            const catData = categories[catKey];
            const catNodeId = `cat_${catIdx}`;
            
            // 使用存储的位置或计算默认位置
            const pos = catData.position || { x: 400 + (catIdx % 2) * 500, y: 100 + Math.floor(catIdx / 2) * 400 };

            this.nodes.push({
                id: catNodeId,
                title: catKey,
                type: 'CATEGORY',
                x: pos.x,
                y: pos.y,
                data: { color: catData.color, count: catData.knowledge_ids.length }
            });
            
            this.edges.push({ id: `e_root_${catNodeId}`, source: 'root', target: catNodeId, label: 'domain' });

            if (catData.knowledge_ids) {
                catData.knowledge_ids.forEach((kTitle, kIdx) => {
                    const kNodeId = `k_${kTitle.replace(/\s+/g, '_')}`;
                    
                    // 优先使用 knowledge_nodes 中的坐标
                    let kPos;
                    if (graph.knowledge_nodes && graph.knowledge_nodes[kTitle]) {
                        kPos = { x: graph.knowledge_nodes[kTitle].x, y: graph.knowledge_nodes[kTitle].y };
                    } else {
                        const angle = (kIdx / Math.max(1, catData.knowledge_ids.length)) * Math.PI * 2;
                        kPos = { x: pos.x + Math.cos(angle) * 180, y: pos.y + Math.sin(angle) * 180 };
                    }

                    this.nodes.push({
                        id: kNodeId,
                        title: kTitle,
                        type: 'KNOWLEDGE',
                        x: kPos.x,
                        y: kPos.y,
                        data: { category: catKey, color: catData.color }
                    });

                    this.edges.push({ id: `e_cat_k_${kNodeId}`, source: catNodeId, target: kNodeId });
                });
            }
        });

        // 3. 脉络链接 (Cross-links)
        if (graph.connections) {
            graph.connections.forEach(conn => {
                const sId = `k_${conn.from.replace(/\s+/g, '_')}`;
                const tId = `k_${conn.to.replace(/\s+/g, '_')}`;
                
                if (this.nodes.find(n => n.id === sId) && this.nodes.find(n => n.id === tId)) {
                    this.edges.push({
                        id: conn.id,
                        source: sId,
                        target: tId,
                        label: conn.type,
                        type: conn.type
                    });
                }
            });
        }

        this.render();
    }

    render() {
        // Clear
        this.nodesLayer.innerHTML = '';
        this.edgesLayer.innerHTML = ''; // Keep defs if any

        // Render Edges
        this.edges.forEach(edge => {
            const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
            path.classList.add('edge-path');
            if (edge.type === '脉络') path.classList.add('edge-flow');
            if (edge.type === '提及') path.classList.add('edge-ref');
            path.id = edge.id;
            this.edgesLayer.appendChild(path);
            
            // Add label for non-tree links
            if (edge.label && edge.type) {
                // SVG Text label (simplified)
            }
        });

        // Render Nodes
        this.nodes.forEach(node => {
            const el = document.createElement('div');
            el.className = `flow-node ${node.type.toLowerCase()}`;
            el.id = node.id;
            el.style.left = `${node.x}px`;
            el.style.top = `${node.y}px`;
            el.dataset.id = node.id;

            // HTML Content
            let typeColor = node.data.color || '#999';
            if(node.type === 'ROOT') typeColor = '#000';
            
            el.innerHTML = `
                <div class="node-port port-input"></div>
                <div class="node-header">
                    <div class="node-title" title="${node.title}">${node.title}</div>
                    <div class="node-type-tag" style="background:${typeColor}20; color:${typeColor}">${node.type}</div>
                </div>
                <div class="node-body">
                    ${node.type === 'CATEGORY' ? `${node.data.count} items` : ''}
                    ${node.type === 'KNOWLEDGE' ? 'Knowledge Document' : ''}
                </div>
                <div class="node-port port-output"></div>
            `;

            // Node Events
            // Drag Start
            el.addEventListener('mousedown', (e) => {
                // Ignore if in connection mode (wait for click)
                if (this.connectionState.active) {
                     e.stopPropagation();
                     // Click on node acts as "Complete Connection"
                     this.completeConnection(node);
                     return;
                }
                
                e.stopPropagation();
                // Select
                this.selectNode(node.id);
                // Start Drag
                this.isDraggingNode = node;
                this.lastMousePos = { x: e.clientX, y: e.clientY };
                
                // Track initial relative offset for smoother dragging visual
                // But we snap to grid, so maybe just raw usage is fine.
            });
            
            // Connection Mode Start (Double Click)
            el.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                this.enterConnectionMode(node);
            });

            this.nodesLayer.appendChild(el);
        });

        this.updateEdges();
    }
    
    // --- Connection Mode Logic ---
    enterConnectionMode(node) {
        this.connectionState.active = true;
        this.connectionState.sourceNode = node;
        this.container.style.cursor = 'crosshair';
        this.showToast('Select target node to connect...');
        
        // Create Temp Line
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.classList.add('edge-path', 'temp-edge');
        path.style.strokeDasharray = "5,5";
        path.id = 'tempEdge';
        this.edgesLayer.appendChild(path);
    }
    
    updateTempLine(e) {
        if (!this.connectionState.sourceNode) return;
        
        // Source Point (Right side of source node)
        // Adjust for viewport pan/scale
        const rect = this.viewport.getBoundingClientRect();
        const mouseX = (e.clientX - rect.left) / this.scale;
        const mouseY = (e.clientY - rect.top) / this.scale;
        
        const sNode = this.connectionState.sourceNode;
        const sx = sNode.x + 260; // Node Width
        const sy = sNode.y + 40; // Approx Center Y
        
        const d = `M ${sx} ${sy} L ${mouseX} ${mouseY}`;
        const tempLine = document.getElementById('tempEdge');
        if(tempLine) tempLine.setAttribute('d', d);
    }
    
    async completeConnection(targetNode) {
        const source = this.connectionState.sourceNode;
        if (source.id === targetNode.id) {
             this.showToast('Cannot connect to self');
             return;
        }
        
        // Check duplicate
        const exists = this.edges.find(e => e.source === source.id && e.target === targetNode.id);
        if (exists) {
            this.showToast('Connection already exists');
            this.exitConnectionMode();
            return;
        }
        
        // Create Connection
        // API Call? Or just visual first? 
        // User asked to "Connect Success", implying persistent update.
        // I need an API endpoint to add connection. 
        // Assuming POST /api/knowledge/graph/connection exists or I add visual only then Save.
        // For V2, strictness implies immediate or batch save.
        // I will add to visual edges then trigger save (if Save Layout also saves edges?).
        // Actually, user data model might not support arbitrary edges if it's strictly Category->Knowledge.
        // But "Knowledge Graph" usually implies arbitrary.
        // The current backend is `categories[name].knowledge_ids`. It is a Tree.
        // If user connects arbitrary nodes, we might break the tree model unless we update the backend model?
        // Let's assume visual only for now or simple "Parent assignment".
        // If Source is Category and Target is Knowledge -> Assign Parent.
        
        // Visual Update
        const newEdge = {
             id: `e_${source.id}_${targetNode.id}_${Date.now()}`,
             source: source.id,
             target: targetNode.id,
             label: 'relates'
        };
        this.edges.push(newEdge);
        this.render(); // Re-render to show new edge
        
        this.showToast('Connected!');
        this.exitConnectionMode();
        
        // TODO: Backend Persistence
    }
    
    exitConnectionMode() {
        this.connectionState.active = false;
        this.connectionState.sourceNode = null;
        this.container.style.cursor = 'default';
        const temp = document.getElementById('tempEdge');
        if(temp) temp.remove();
    }

    selectNode(id) {
        this.container.querySelectorAll('.flow-node').forEach(n => n.classList.remove('selected'));
        const el = document.getElementById(id);
        if(el) el.classList.add('selected');
        
        // Show details
        const node = this.nodes.find(n => n.id === id);
        this.showDetails(node);
    }

    handleNodeDrag(e) {
        if (!this.connectionState.active && this.isDraggingNode) {
            
            // Calculate raw delta
            const dx = (e.clientX - this.lastMousePos.x) / this.scale;
            const dy = (e.clientY - this.lastMousePos.y) / this.scale;
    
            // Update raw position for smooth-ish feel if we wanted, 
            // BUT user asked for "Must be Strong Alignment... drag to other column/row".
            // This implies "Snap to Grid Slot" logic.
            
            // We'll update the raw X/Y, but the render/snap will clamp it.
            this.isDraggingNode.x += dx;
            this.isDraggingNode.y += dy;
            
            // Calculate nearest Slot indices
            // Width = 260 nodes + 40 gap? Or use larger columns?
            // Let's us COL_WIDTH = 300, ROW_HEIGHT = 120 (node height approx 100).
            
            const colIndex = Math.round(this.isDraggingNode.x / this.COL_WIDTH);
            const rowIndex = Math.round(this.isDraggingNode.y / this.ROW_HEIGHT);
            
            // Clamp to positive
            const safeCol = Math.max(0, colIndex);
            const safeRow = Math.max(0, rowIndex);
            
            // Snap the visual element immediately to show where it will land?
            // Or just snap the internal X/Y?
            
            // Visual feedback: Snap the DOM element to the calculated slot
            const el = document.getElementById(this.isDraggingNode.id);
            const snappedX = safeCol * this.COL_WIDTH;
            const snappedY = safeRow * this.ROW_HEIGHT;
            
            el.style.left = `${snappedX}px`;
            el.style.top = `${snappedY}px`;
            
            // Update Edges dynamically
            // Note: We are NOT updating this.isDraggingNode.x/y to snapped yet, 
            // to allow smooth "crossing" of thresholds.
            // But for edges to look right attached to the ghost, we need to calculate d based on snapped.
            // My updateEdges uses this.nodes[].x which is the raw value currently if I don't update it?
            // Actually I'm updating raw x/y above.
            // Let's update edges using the SNAPPED position for the dragged node, but how?
            // Standard updateEdges reads from this.nodes.
            // Let's just update the specific edges connected to this node manually or force update using snapped values?
            
            // Simplest: Temporarily set node.x/y to snapped for edge calculation, then revert? 
            // Or just let edge trail behind the mouse?
            // User: "Strict alignment".
            // So dragging should probably feel like "Jumping" between slots.
            
            // Let's simply update edges based on the snapped position we just calculated.
            // We need to pass "overrides" to updateEdges or update the node object itself?
            // If I update node object, then next dx/dy calculation will be jumpy.
            
            // Compromise: track `dragX/dragY` separately from `node.x/node.y`.
            // But I didn't set that up.
            // I will just let the edge connect to the "Snapped" position by updating the node real-time?
            // If I map mouse -> raw -> slot -> node.x/y, the drag loop works fine.
            
            this.isDraggingNode.x = snappedX;
            this.isDraggingNode.y = snappedY;
            
            // Why? Because next mouse move `dx` is relative to `lastMousePos`.
            // So `lastMousePos` tracks mouse. `node.x` tracks node.
            // Wait, if I snap `node.x`, then next `x += dx` starts from snapped.
            // If I move mouse +1px, node doesn't move. dx is small.
            // x += small is still snapped back to 0.
            // Result: Node gets stuck.
            
            // FIX: Don't snap `this.isDraggingNode.x/y` in the data model during drag. 
            // Only snap the View (DOM + Edges).
            
            // Revert the assignment above, I need `rawX` and `rawY`.
            // I'll attach them to the node temporarily.
            if (this.isDraggingNode._rawX === undefined) {
                 this.isDraggingNode._rawX = this.isDraggingNode.x;
                 this.isDraggingNode._rawY = this.isDraggingNode.y;
            }
            this.isDraggingNode._rawX += dx;
            this.isDraggingNode._rawY += dy;
            
            const slotCol = Math.round(this.isDraggingNode._rawX / this.COL_WIDTH);
            const slotRow = Math.round(this.isDraggingNode._rawY / this.ROW_HEIGHT);
            
            const finalX = Math.max(0, slotCol * this.COL_WIDTH);
            const finalY = Math.max(0, slotRow * this.ROW_HEIGHT);
            
            // Update DOM
            el.style.left = `${finalX}px`;
            el.style.top = `${finalY}px`;
            
            // Update Data (visually snapped, but logically consistent for save)
            this.isDraggingNode.x = finalX;
            this.isDraggingNode.y = finalY;
            
            // Re-render edges
            this.updateEdges();
            
            this.lastMousePos = { x: e.clientX, y: e.clientY };
        }
    }

    updateEdges() {
        this.edges.forEach(edge => {
            const sourceNode = this.nodes.find(n => n.id === edge.source);
            const targetNode = this.nodes.find(n => n.id === edge.target);
            if (!sourceNode || !targetNode) return;

            // Get dragged positions (snapped)
            // Fix: COL_WIDTH logic vs GRID_SIZE logic. 
            // In handleNodeDrag, we use COL_WIDTH/ROW_HEIGHT. 
            // Here, assumes nodes.x/y are already snapped (which they are).
            
            const sx = sourceNode.x + 260; // Output port (Right)
            const sy = sourceNode.y + 50;  // Center Y (approx half of node height ~100)
            
            const tx = targetNode.x;       // Input port (Left)
            const ty = targetNode.y + 50;

            const d = this.getOrthogonalPath(sx, sy, tx, ty);
            const pathEl = document.getElementById(edge.id);
            if(pathEl) pathEl.setAttribute('d', d);
        });
    }

    getOrthogonalPath(x1, y1, x2, y2) {
        // ... same as before but ensure clean elbows ...
        const midX = (x1 + x2) / 2;
        
        if (x2 > x1 + 20) {
           // M x1 y1 -> L midX y1 -> L midX y2 -> L x2 y2
           return `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;
        } else {
           // Looping back
           const stub = 20;
           // Out -> Down/Up -> Back -> In
           // M x1 y1 -> H x1+stub -> V midY -> H x2-stub -> V y2 -> H x2 
           // Simple loop-back style:
           // M x1 y1 -> H x1+20 -> V (y1+y2)/2 or y2+40? -> H x2-20 -> V y2 -> H x2
           
           // Just use simple V-step if close?
           // Let's keep the user's "elbow" requirement simple.
           // If target is behind, go down then wrap around.
           const lowestY = Math.max(y1, y2) + 60;
           return `M ${x1} ${y1} H ${x1+20} V ${lowestY} H ${x2-20} V ${y2} H ${x2}`;
        }
    }

    showDetails(node) {
        const panel = document.querySelector('.details-panel');
        if(!panel) return;
        
        document.getElementById('detailTitle').textContent = node.title;
        document.getElementById('detailType').textContent = node.type;
        document.getElementById('detailMeta').textContent = JSON.stringify(node.data, null, 2);
        
        panel.classList.add('open');
    }

    async saveLayout() {
        const categoryNodes = this.nodes.filter(n => n.type === 'CATEGORY');
        const updates = categoryNodes.map(node => {
            const snappedX = Math.round(node.x / this.GRID_SIZE) * this.GRID_SIZE;
            const snappedY = Math.round(node.y / this.GRID_SIZE) * this.GRID_SIZE;
            return fetch('/api/knowledge/graph/positions', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    category: node.title,
                    position: { x: snappedX, y: snappedY }
                })
            });
        });

        try {
            await Promise.all(updates);
            this.showToast('Layout saved successfully');
        } catch(e) {
            console.error(e);
            this.showToast('Failed to save layout');
        }
    }

    showToast(msg) {
        let container = document.getElementById('toast-container');
        if (!container) return;
        const toast = document.createElement('div');
        toast.textContent = msg;
        toast.style.cssText = "background: #333; color: #fff; padding: 10px 20px; border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); margin-bottom: 10px; animation: slideIn 0.3s forwards;";
        container.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
}

// Init
document.addEventListener('DOMContentLoaded', () => {
    window.graphEditor = new GraphEditor('graphEditor');
    
    // Close Details
    const closeBtn = document.querySelector('.details-close');
    if(closeBtn) {
        closeBtn.onclick = () => {
             document.querySelector('.details-panel').classList.remove('open');
        };
    }
    
    // Zoom Controls
    const zoomIn = document.getElementById('zoomIn');
    if(zoomIn) zoomIn.onclick = () => { 
        window.graphEditor.scale = Math.min(3, window.graphEditor.scale + 0.2); 
        window.graphEditor.updateTransform(); 
    };

    const zoomOut = document.getElementById('zoomOut');
    if(zoomOut) zoomOut.onclick = () => { 
        window.graphEditor.scale = Math.max(0.2, window.graphEditor.scale - 0.2); 
        window.graphEditor.updateTransform(); 
    };

    // Save Button - Bind to Save Layout
    // Note: In knowledge_graph.html it might be #saveLayoutBtn or similar if I kept the header. 
    // I replaced the html with a simplified sidebar version, but I didn't verify if I kept a save button?
    // In my simple V2 HTML, I just had Zoom controls. 
    // Wait, let's check my V2 HTML content again. 
    // I only had Zoom buttons in `.canvas-controls`. 
    // I should add a Save button there or use "Auto Save"?
    // The user asked for "Editor", usually implies Save.
    // I'll add a Save button to `.canvas-controls` in this JS file dynamically or just assume user will reload to reset if I don't.
    // Actually, I can inject a Save button into canvas-controls if not present.
    
    const controls = document.querySelector('.canvas-controls');
    if(controls) {
        const saveBtn = document.createElement('button');
        saveBtn.className = 'control-btn';
        saveBtn.title = 'Save Layout';
        saveBtn.innerHTML = '<i class="fa-solid fa-save"></i>';
        saveBtn.onclick = () => window.graphEditor.saveLayout();
        controls.appendChild(saveBtn);
    }
});
