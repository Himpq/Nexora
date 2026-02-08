/**
 * Node Graph - Node Editor Style (Div + SVG)
 * Categories are containers, Knowledge items are inside.
 */
class NodeGraph {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.viewport = this.container.parentElement;
        this.categories = {};
        this.connections = [];
        this.nodes = {}; // Map of title -> {el, category}
        
        this.transform = { x: 0, y: 0, k: 1 };
        this.dragState = { 
            isPanning: false, 
            isDraggingBox: false, 
            isDraggingItem: false,
            isConnecting: false,
            target: null, 
            ghost: null,
            start: {x:0, y:0}, 
            initialPos: {x:0, y:0},
            moved: false,
            threshold: 5
        };
        
        this.requestFrame = null;
        this.init();
    }

    init() {
        this.container.innerHTML = '';
        this.container.style.userSelect = 'none'; 
        this.container.style.overflow = 'hidden';
        this.container.style.position = 'relative';

        this.content = document.createElement('div');
        this.content.className = 'graph-content';
        this.content.style.position = 'absolute';
        this.content.style.width = '1px';
        this.content.style.height = '1px';
        this.content.style.transformOrigin = '0 0';
        this.container.appendChild(this.content);

        // SVG Layer
        this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        this.svg.setAttribute('class', 'edge-layer');
        this.svg.style.position = 'absolute';
        this.svg.style.top = '0';
        this.svg.style.left = '0';
        this.svg.style.width = '20000px';
        this.svg.style.height = '20000px';
        this.svg.style.pointerEvents = 'none';
        this.svg.style.zIndex = '1';
        this.content.appendChild(this.svg);
        this.edgeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        this.svg.appendChild(this.edgeGroup);

        // Ghost element for dragging items
        this.ghost = document.createElement('div');
        this.ghost.className = 'knowledge-item ghost';
        this.ghost.style.position = 'fixed';
        this.ghost.style.top = '0';
        this.ghost.style.left = '0';
        this.ghost.style.margin = '0';
        this.ghost.style.pointerEvents = 'none';
        this.ghost.style.display = 'none';
        this.ghost.style.zIndex = '9999';
        this.ghost.style.opacity = '0.9';
        this.ghost.style.boxShadow = '0 10px 25px rgba(0,0,0,0.2)';
        this.ghost.style.transformOrigin = 'center center';
        document.body.appendChild(this.ghost);

        this.setupEventListeners();
    }

    setData(categories, connections) {
        this.categories = categories;
        this.connections = connections || [];
        this.render();
    }

    render() {
        const oldNodes = this.content.querySelectorAll('.category-node');
        oldNodes.forEach(n => n.remove());
        this.nodes = {};

        Object.entries(this.categories).forEach(([name, data]) => {
            const el = this.createCategoryBox(name, data);
            this.content.appendChild(el);
        });

        requestAnimationFrame(() => this.updateEdges());
    }

    createCategoryBox(name, data) {
        const box = document.createElement('div');
        box.className = 'category-node';
        box.id = `cat-${this.safeId(name)}`;
        box.style.left = `${data.position.x}px`;
        box.style.top = `${data.position.y}px`;
        box.dataset.name = name;

        const header = document.createElement('div');
        header.className = 'category-header';
        header.style.borderTop = `4px solid ${data.color || '#3b82f6'}`;
        header.innerHTML = `
            <div class="category-title">${escapeHtml(name)}</div>
            <div class="category-count">${data.knowledge_ids.length}</div>
        `;
        header.onmousedown = (e) => this.startDragBox(e, box);

        const content = document.createElement('div');
        content.className = 'category-content';

        data.knowledge_ids.forEach(kid => {
            const item = document.createElement('div');
            item.className = 'knowledge-item';
            item.id = `node-${this.safeId(kid)}`;
            item.dataset.title = kid;
            item.innerHTML = `<span>${escapeHtml(kid)}</span><div class="port"></div>`;
            
            item.onmousedown = (e) => this.startDragItem(e, item, kid);
            item.onclick = (e) => {
                if (!this.dragState.moved) {
                    if (window.showNote) window.showNote(kid);
                }
            };

            const port = item.querySelector('.port');
            port.onmousedown = (e) => this.startConnection(e, kid, item);

            content.appendChild(item);
            this.nodes[kid] = { el: item, category: name };
        });

        box.appendChild(header);
        box.appendChild(content);
        return box;
    }

    safeId(str) {
        return str.replace(/[^a-zA-Z0-9]/g, '_');
    }

    updateEdges() {
        this.edgeGroup.innerHTML = '';
        this.connections.forEach(conn => {
            const path = this.createSpline(conn.from, conn.to);
            if (path) this.edgeGroup.appendChild(path);
        });
        
        if (this.dragState.isConnecting && this.dragState.tempEdge) {
            this.edgeGroup.appendChild(this.dragState.tempEdge);
        }
    }

    createSpline(fromId, toId, tempX = null, tempY = null) {
        const fromEl = document.getElementById(`node-${this.safeId(fromId)}`);
        if (!fromEl) return null;

        const fromRect = fromEl.getBoundingClientRect();
        const contentRect = this.content.getBoundingClientRect();

        const startX = (fromRect.right - contentRect.left) / this.transform.k;
        const startY = (fromRect.top + fromRect.height / 2 - contentRect.top) / this.transform.k;
        
        let endX, endY;
        if (tempX !== null) {
            endX = tempX; endY = tempY;
        } else {
            const toEl = document.getElementById(`node-${this.safeId(toId)}`);
            if (!toEl) return null;
            const toRect = toEl.getBoundingClientRect();
            endX = (toRect.left - contentRect.left) / this.transform.k;
            endY = (toRect.top + toRect.height / 2 - contentRect.top) / this.transform.k;
        }

        const delta = Math.abs(endX - startX) * 0.5 + 40;
        const cp1x = startX + delta;
        const cp2x = endX - delta;

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', `M ${startX} ${startY} C ${cp1x} ${startY}, ${cp2x} ${endY}, ${endX} ${endY}`);
        path.setAttribute('class', 'graph-edge');
        path.style.fill = 'none';
        path.style.stroke = tempX !== null ? '#3b82f6' : '#94a3b8';
        path.style.strokeWidth = '2';
        path.style.opacity = tempX !== null ? '0.8' : '0.4';
        return path;
    }

    setupEventListeners() {
        this.container.onmousedown = (e) => {
            if (e.target === this.container || e.target === this.content) {
                this.dragState.isPanning = true;
                this.dragState.start = { x: e.clientX, y: e.clientY };
                this.dragState.initialPos = { x: this.transform.x, y: this.transform.y };
                this.container.style.cursor = 'grabbing';
            }
        };

        window.addEventListener('mousemove', (e) => {
            this.dragState.lastEvent = e;
            if (this.requestFrame) return;
            this.requestFrame = requestAnimationFrame(() => {
                const lastEvent = this.dragState.lastEvent;
                if (lastEvent) this.handleMouseMove(lastEvent);
                this.requestFrame = null;
            });
        });

        window.addEventListener('mouseup', (e) => {
            this.handleMouseUp(e);
        });

        window.addEventListener('blur', () => {
            this.cancelDrag();
        });

        document.addEventListener('visibilitychange', () => {
            if (document.hidden) this.cancelDrag();
        });

        document.addEventListener('mouseleave', () => {
            this.cancelDrag();
        });

        this.container.onwheel = (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            const newK = Math.min(Math.max(this.transform.k * delta, 0.1), 3);
            const rect = this.container.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            const beforeX = (mouseX - this.transform.x) / this.transform.k;
            const beforeY = (mouseY - this.transform.y) / this.transform.k;
            this.transform.k = newK;
            this.transform.x = mouseX - beforeX * this.transform.k;
            this.transform.y = mouseY - beforeY * this.transform.k;
            this.updateTransform();
        };
    }

    handleMouseMove(e) {
        const dx = e.clientX - this.dragState.start.x;
        const dy = e.clientY - this.dragState.start.y;
        
        if (Math.abs(dx) > this.dragState.threshold || Math.abs(dy) > this.dragState.threshold) {
            this.dragState.moved = true;
        }

        if (this.dragState.isPanning) {
            this.transform.x = this.dragState.initialPos.x + dx;
            this.transform.y = this.dragState.initialPos.y + dy;
            this.updateTransform();
        } else if (this.dragState.isDraggingBox && this.dragState.target) {
            this.dragState.target.style.left = `${this.dragState.initialPos.x + dx / this.transform.k}px`;
            this.dragState.target.style.top = `${this.dragState.initialPos.y + dy / this.transform.k}px`;
            this.updateEdges();
        } else if (this.dragState.isDraggingItem && this.dragState.target) {
            // Update ghost position using translate3d for max performance (hardware acceleration)
            this.ghost.style.display = 'flex';
            const gx = e.clientX - (this.dragState.offset?.x || 0);
            const gy = e.clientY - (this.dragState.offset?.y || 0);
            this.ghost.style.transform = `translate3d(${gx}px, ${gy}px, 0)`;
            
            // Highlight target category
            const cats = document.querySelectorAll('.category-node');
            cats.forEach(cat => {
                const r = cat.getBoundingClientRect();
                if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
                    cat.classList.add('drag-over');
                } else {
                    cat.classList.remove('drag-over');
                }
            });
        } else if (this.dragState.isConnecting) {
            const contentRect = this.content.getBoundingClientRect();
            const mx = (e.clientX - contentRect.left) / this.transform.k;
            const my = (e.clientY - contentRect.top) / this.transform.k;
            this.dragState.tempEdge = this.createSpline(this.dragState.fromNode, null, mx, my);
            this.updateEdges();
        }
    }

    handleMouseUp(e) {
        if (this.dragState.isDraggingBox && this.dragState.target) {
            this.savePosition(this.dragState.target.dataset.name, {
                x: parseFloat(this.dragState.target.style.left),
                y: parseFloat(this.dragState.target.style.top)
            });
        } else if (this.dragState.isDraggingItem) {
            this.ghost.style.display = 'none';
            this.handleDropItem(e);
            document.querySelectorAll('.category-node').forEach(c => c.classList.remove('drag-over'));
        } else if (this.dragState.isConnecting) {
            this.handleConnectionDrop(e);
        }

        this.dragState.isPanning = false;
        this.dragState.isDraggingBox = false;
        this.dragState.isDraggingItem = false;
        this.dragState.isConnecting = false;
        this.dragState.target = null;
        this.dragState.tempEdge = null;
        this.container.style.cursor = 'grab';
    }

    cancelDrag() {
        if (!this.dragState.isPanning && !this.dragState.isDraggingBox && !this.dragState.isDraggingItem && !this.dragState.isConnecting) {
            return;
        }

        if (this.dragState.isDraggingItem) {
            this.ghost.style.display = 'none';
            document.querySelectorAll('.category-node').forEach(c => c.classList.remove('drag-over'));
        }

        this.dragState.isPanning = false;
        this.dragState.isDraggingBox = false;
        this.dragState.isDraggingItem = false;
        this.dragState.isConnecting = false;
        this.dragState.target = null;
        this.dragState.tempEdge = null;
        this.container.style.cursor = 'grab';
    }

    startDragBox(e, el) {
        e.stopPropagation();
        this.dragState.isDraggingBox = true;
        this.dragState.target = el;
        this.dragState.start = { x: e.clientX, y: e.clientY };
        this.dragState.initialPos = { x: parseFloat(el.style.left) || 0, y: parseFloat(el.style.top) || 0 };
        this.dragState.moved = false;
    }

    startDragItem(e, el, title) {
        e.stopPropagation();
        this.dragState.isDraggingItem = true;
        this.dragState.target = el;
        this.dragState.start = { x: e.clientX, y: e.clientY };
        
        // Calculate offset to prevent jumping
        const rect = el.getBoundingClientRect();
        this.dragState.offset = {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };

        this.dragState.moved = false;
        this.ghost.innerHTML = el.innerHTML;
        this.ghost.style.width = `${el.offsetWidth}px`;
        this.ghost.style.height = `${el.offsetHeight}px`;
        this.ghost.style.transition = 'none';
        this.ghost.style.willChange = 'transform';
        // Clear old transform to prevent additive offsets
        this.ghost.style.transform = 'none'; 
    }

    startConnection(e, fromTitle, el) {
        e.stopPropagation();
        this.dragState.isConnecting = true;
        this.dragState.fromNode = fromTitle;
        this.dragState.start = { x: e.clientX, y: e.clientY };
    }

    async handleDropItem(e) {
        const title = this.dragState.target.dataset.title;
        
        let targetCatName = null;
        let targetCatEl = null;
        const cats = document.querySelectorAll('.category-node');
        cats.forEach(cat => {
            const r = cat.getBoundingClientRect();
            if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
                targetCatName = cat.dataset.name;
                targetCatEl = cat;
            }
        });

        const oldCatName = this.nodes[title].category;
        if (!targetCatName || targetCatName === oldCatName) return;

        // Optimistic UI update
        const oldParent = this.dragState.target.parentElement;
        this.nodes[title].category = targetCatName;

        if (targetCatEl) {
            const targetContent = targetCatEl.querySelector('.category-content');
            if (targetContent) targetContent.appendChild(this.dragState.target);
        }

        this.updateCategoryCount(oldCatName, -1);
        this.updateCategoryCount(targetCatName, 1);
        this.updateCategoryData(oldCatName, targetCatName, title);

        try {
            const res = await fetch('/api/knowledge/move', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ knowledge: title, category: targetCatName })
            });
            const data = await res.json();
            if (data.success) {
                if (window.loadData) window.loadData(true);
            } else {
                this.rollbackMove(title, oldCatName, oldParent, targetCatName);
                if (window.loadData) window.loadData(true);
            }
        } catch(e) {
            this.rollbackMove(title, oldCatName, oldParent, targetCatName);
            if (window.loadData) window.loadData(true);
        }
    }

    rollbackMove(title, oldCatName, oldParent, targetCatName) {
        this.nodes[title].category = oldCatName;
        if (oldParent) oldParent.appendChild(this.dragState.target);
        this.updateCategoryCount(targetCatName, -1);
        this.updateCategoryCount(oldCatName, 1);
        this.updateCategoryData(targetCatName, oldCatName, title);
    }

    updateCategoryCount(catName, delta) {
        const cats = document.querySelectorAll('.category-node');
        let target = null;
        cats.forEach(cat => {
            if (cat.dataset.name === catName) target = cat;
        });
        if (!target) return;
        const countEl = target.querySelector('.category-count');
        if (!countEl) return;
        const current = parseInt(countEl.textContent || '0', 10) || 0;
        countEl.textContent = Math.max(0, current + delta);
    }

    updateCategoryData(fromCat, toCat, title) {
        if (this.categories[fromCat]) {
            const idx = this.categories[fromCat].knowledge_ids.indexOf(title);
            if (idx >= 0) this.categories[fromCat].knowledge_ids.splice(idx, 1);
        }
        if (this.categories[toCat]) {
            if (!this.categories[toCat].knowledge_ids.includes(title)) {
                this.categories[toCat].knowledge_ids.push(title);
            }
        }
    }

    async handleConnectionDrop(e) {
        const targets = document.querySelectorAll('.knowledge-item');
        let toTitle = null;
        targets.forEach(item => {
            const r = item.getBoundingClientRect();
            if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
                toTitle = item.dataset.title;
            }
        });

        if (toTitle && toTitle !== this.dragState.fromNode) {
            try {
                const res = await fetch('/api/knowledge/connections', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ from: this.dragState.fromNode, to: toTitle, type: '关联' })
                });
                const data = await res.json();
                if (data.success) {
                    if (window.loadData) window.loadData(true);
                }
            } catch(e) {}
        }
    }

    updateTransform() {
        this.content.style.transform = `translate(${this.transform.x}px, ${this.transform.y}px) scale(${this.transform.k})`;
    }

    async savePosition(name, pos) {
        try {
            await fetch('/api/knowledge/graph/positions', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ [name]: pos })
            });
        } catch(e) {}
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
