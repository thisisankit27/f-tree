/*
 * Drawing the archive.
 *
 * Everything goes into one canvas, the way the app draws its chart, because a few thousand cards as
 * DOM elements is a few thousand things for the browser to lay out on every pan.
 *
 * The idea that makes a whole archive readable is semantic zoom. Drawing every name at every scale
 * would give an unreadable grey wash when the whole tree is on screen, so the chart draws less as
 * it pulls back: at a distance, cards are plain shapes and what you read is the *shape* of the
 * family - how many generations, how wide each one got, where the record has holes, because an
 * unknown person keeps their brass dashed edge at every scale. Names appear when they can be read,
 * dates below that, photographs last.
 */

import { displayName, lifespan, initials } from './model.js';

export const PALETTES = {
  // Both palettes are the app's own, from ui/theme/Color.kt, so the page and the product are
  // recognisably the same object rather than two designs that merely agree about green.
  light: {
    ground: '#f7f6f1',
    raised: '#ffffff',
    ink: '#1a1c1a',
    inkSoft: '#414942',
    inkFaint: '#656d65',
    forest: '#2a5138',
    sage: '#8fc7a1',
    sageContainer: '#cde6d5',
    brass: '#8a6420',
    brassSurface: '#f7eedc',
    rule: '#9aa69b',
    spouseLink: '#5e8c6d',
    frame: '#dcdcd2',
    band: '#e7e6de',
  },
  dark: {
    ground: '#10150f',
    raised: '#1a211a',
    ink: '#e0e4dd',
    inkSoft: '#b9c2b8',
    inkFaint: '#8b968b',
    forest: '#8fc7a1',
    sage: '#8fc7a1',
    sageContainer: '#24402e',
    brass: '#e3c38c',
    brassSurface: '#2c2618',
    rule: '#5c665c',
    spouseLink: '#8fc7a1',
    frame: '#28312a',
    band: '#182018',
  },
};

/** What gets drawn at which scale. Below NAMES the chart is deliberately wordless. */
const TIER = { NAMES: 0.34, DATES: 0.58, PHOTOS: 0.92 };

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

export class Chart {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.layout = null;
    this.graph = null;
    this.archive = null;

    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.minScale = 0.02;
    this.maxScale = 3;

    this.theme = 'light';
    this.showPhotos = true;
    this.selected = null;
    this.hovered = null;
    this.related = null;      // ids drawn at full strength while the rest dim
    this.pathIds = null;      // the chain from one person to another
    this.matches = null;      // search results, marked with a ring

    this.onSelect = options.onSelect ?? (() => {});
    this.onHover = options.onHover ?? (() => {});
    this.onViewChange = options.onViewChange ?? (() => {});

    this.photos = new Map();
    this.photoQueue = new Set();
    this.textCache = new Map();
    this.dirty = true;
    this.frame = null;

    this.bindPointer();
    this.resize();
  }

  get palette() {
    return PALETTES[this.theme];
  }

  setTheme(theme) {
    this.theme = theme;
    this.invalidate();
  }

  load(graph, layout, archive) {
    this.graph = graph;
    this.layout = layout;
    this.archive = archive;
    this.photos.clear();
    this.textCache.clear();
    this.selected = null;
    this.related = null;
    this.pathIds = null;
    this.buildIndex();
    this.invalidate();
  }

  /**
   * A coarse grid over the nodes.
   *
   * Hit testing runs on every pointer move; scanning a few thousand nodes each time is wasteful
   * when a bucket lookup answers the same question in constant time.
   */
  buildIndex() {
    const cell = 400;
    const grid = new Map();
    for (const node of this.layout.nodes) {
      const cx = Math.floor(node.x / cell);
      const cy = Math.floor(node.y / cell);
      const key = `${cx},${cy}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(node);
    }
    this.grid = grid;
    this.cell = cell;
  }

  nodeAt(worldX, worldY) {
    if (!this.layout) return null;
    const { NODE_W, NODE_H } = this.layout.metrics;
    const key = `${Math.floor(worldX / this.cell)},${Math.floor(worldY / this.cell)}`;
    for (const node of this.grid.get(key) ?? []) {
      if (worldX >= node.x && worldX <= node.x + NODE_W
        && worldY >= node.y && worldY <= node.y + NODE_H) return node;
    }
    return null;
  }

  /* ---------------------------------------------------------------- view */

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    this.viewWidth = rect.width;
    this.viewHeight = rect.height;
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.dpr = dpr;
    this.invalidate();
  }

  fit(padding = 40) {
    if (!this.layout || !this.viewWidth) return;
    const sx = (this.viewWidth - padding * 2) / this.layout.width;
    const sy = (this.viewHeight - padding * 2) / this.layout.height;
    this.scale = clamp(Math.min(sx, sy), this.minScale, 1.4);
    this.offsetX = (this.viewWidth - this.layout.width * this.scale) / 2;
    this.offsetY = (this.viewHeight - this.layout.height * this.scale) / 2;
    this.invalidate();
    this.onViewChange();
  }

  /** The scale at which the whole archive would fit, used to decide whether fitting is useful. */
  fitScale(padding = 40) {
    if (!this.layout || !this.viewWidth) return 1;
    return Math.min(
      (this.viewWidth - padding * 2) / this.layout.width,
      (this.viewHeight - padding * 2) / this.layout.height
    );
  }

  centreOn(id, scale) {
    const node = this.layout?.byId.get(id);
    if (!node) return;
    const { NODE_W, NODE_H } = this.layout.metrics;
    if (scale) this.scale = clamp(scale, this.minScale, this.maxScale);
    this.offsetX = this.viewWidth / 2 - (node.x + NODE_W / 2) * this.scale;
    this.offsetY = this.viewHeight / 2 - (node.y + NODE_H / 2) * this.scale;
    this.invalidate();
    this.onViewChange();
  }

  zoomBy(factor, anchorX, anchorY) {
    const ax = anchorX ?? this.viewWidth / 2;
    const ay = anchorY ?? this.viewHeight / 2;
    const next = clamp(this.scale * factor, this.minScale, this.maxScale);
    if (next === this.scale) return;
    // Keep whatever is under the anchor exactly where it is.
    this.offsetX = ax - (ax - this.offsetX) * (next / this.scale);
    this.offsetY = ay - (ay - this.offsetY) * (next / this.scale);
    this.scale = next;
    this.invalidate();
    this.onViewChange();
  }

  panBy(dx, dy) {
    this.offsetX += dx;
    this.offsetY += dy;
    this.invalidate();
  }

  /* ---------------------------------------------------------------- interaction */

  bindPointer() {
    const canvas = this.canvas;
    const pointers = new Map();
    let dragging = false;
    let moved = 0;
    let last = null;
    let pinchDistance = 0;

    canvas.addEventListener('pointerdown', (e) => {
      // Capture keeps a drag alive past the edge of the canvas. It throws if the pointer is
      // already gone, which must not take the whole gesture down with it.
      try { canvas.setPointerCapture(e.pointerId); } catch { /* nothing to capture */ }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        dragging = true;
        moved = 0;
        last = { x: e.clientX, y: e.clientY };
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });

    canvas.addEventListener('pointermove', (e) => {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDistance > 0) {
          const rect = canvas.getBoundingClientRect();
          this.zoomBy(distance / pinchDistance, (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top);
        }
        pinchDistance = distance;
        return;
      }

      if (dragging && last) {
        const dx = e.clientX - last.x;
        const dy = e.clientY - last.y;
        moved += Math.abs(dx) + Math.abs(dy);
        last = { x: e.clientX, y: e.clientY };
        this.panBy(dx, dy);
        return;
      }

      const world = this.toWorld(e);
      const node = this.nodeAt(world.x, world.y);
      const id = node?.id ?? null;
      if (id !== this.hovered) {
        this.hovered = id;
        canvas.style.cursor = id ? 'pointer' : 'grab';
        this.onHover(id);
        this.invalidate();
      }
    });

    const release = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchDistance = 0;
      if (pointers.size === 0) {
        // A drag that barely moved is a tap, not a pan - the distinction matters most on a tablet.
        if (dragging && moved < 6) {
          const world = this.toWorld(e);
          this.onSelect(this.nodeAt(world.x, world.y)?.id ?? null);
        }
        dragging = false;
        last = null;
      }
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      // Ctrl+wheel is the pinch gesture a trackpad sends; plain wheel scrolls the chart.
      if (e.ctrlKey || e.metaKey) {
        this.zoomBy(Math.exp(-e.deltaY * 0.01), e.clientX - rect.left, e.clientY - rect.top);
      } else if (e.shiftKey) {
        this.panBy(-e.deltaY, 0);
      } else {
        this.zoomBy(Math.exp(-e.deltaY * 0.0016), e.clientX - rect.left, e.clientY - rect.top);
      }
    }, { passive: false });

    canvas.addEventListener('dblclick', (e) => {
      const world = this.toWorld(e);
      const node = this.nodeAt(world.x, world.y);
      if (node) this.centreOn(node.id, Math.max(this.scale, 1));
    });
  }

  toWorld(event) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left - this.offsetX) / this.scale,
      y: (event.clientY - rect.top - this.offsetY) / this.scale,
    };
  }

  /* ---------------------------------------------------------------- photos */

  async requestPhoto(path) {
    if (!this.archive || this.photos.has(path) || this.photoQueue.has(path)) return;
    if (!this.archive.has(path)) { this.photos.set(path, null); return; }
    this.photoQueue.add(path);
    try {
      const bytes = await this.archive.read(path);
      const bitmap = await createImageBitmap(new Blob([bytes]));
      this.photos.set(path, bitmap);
    } catch {
      this.photos.set(path, null);   // a photo that will not decode simply falls back to initials
    } finally {
      this.photoQueue.delete(path);
      this.invalidate();
    }
  }

  /* ---------------------------------------------------------------- drawing */

  invalidate() {
    this.dirty = true;
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      if (this.dirty) this.draw();
    });
  }

  ellipsise(ctx, text, maxWidth, key) {
    const cacheKey = `${key}|${text}|${Math.round(maxWidth)}`;
    const hit = this.textCache.get(cacheKey);
    if (hit !== undefined) return hit;
    let out = text;
    if (ctx.measureText(text).width > maxWidth) {
      let lo = 0;
      let hi = text.length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxWidth) lo = mid; else hi = mid - 1;
      }
      out = `${text.slice(0, lo)}…`;
    }
    if (this.textCache.size > 4000) this.textCache.clear();
    this.textCache.set(cacheKey, out);
    return out;
  }

  draw() {
    this.dirty = false;
    const ctx = this.ctx;
    const c = this.palette;
    const s = this.scale;

    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.fillStyle = c.ground;
    ctx.fillRect(0, 0, this.viewWidth, this.viewHeight);

    if (!this.layout) { ctx.restore(); return; }

    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(s, s);

    // The world rectangle currently on screen, so nothing offscreen costs anything to draw.
    const view = {
      x0: -this.offsetX / s,
      y0: -this.offsetY / s,
      x1: (-this.offsetX + this.viewWidth) / s,
      y1: (-this.offsetY + this.viewHeight) / s,
    };

    this.drawBands(ctx, c, view, s);
    this.drawGroups(ctx, c, view, s);
    this.drawDescents(ctx, c, view, s);
    this.drawSiblings(ctx, c, view, s);
    this.drawCouples(ctx, c, view, s);
    this.drawNodes(ctx, c, view, s);

    ctx.restore();
  }

  drawBands(ctx, c, view, s) {
    const { NODE_H } = this.layout.metrics;
    ctx.save();
    ctx.strokeStyle = c.band;
    ctx.lineWidth = 1 / s;
    for (const band of this.layout.bands) {
      const y = band.y + NODE_H / 2;
      if (y < view.y0 - 40 || y > view.y1 + 40) continue;
      ctx.beginPath();
      ctx.moveTo(band.x, y);
      ctx.lineTo(band.x + band.width, y);
      ctx.stroke();
    }
    if (s > 0.22) {
      ctx.fillStyle = c.inkFaint;
      ctx.font = `500 ${13 / s}px "JetBrains Mono", ui-monospace, monospace`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      for (const band of this.layout.bands) {
        const y = band.y + NODE_H / 2;
        if (y < view.y0 - 40 || y > view.y1 + 40) continue;
        ctx.fillText(`G${band.level + 1}`, band.x + 8, y - 14 / s);
      }
    }
    ctx.restore();
  }

  drawGroups(ctx, c, view, s) {
    ctx.save();
    ctx.strokeStyle = c.frame;
    ctx.lineWidth = 1.5 / s;
    for (const group of this.layout.groups) {
      if (group.x > view.x1 || group.x + group.width < view.x0
        || group.y > view.y1 || group.y + group.height < view.y0) continue;
      ctx.setLineDash(group.kind === 'isolated' ? [8 / s, 6 / s] : []);
      roundRect(ctx, group.x, group.y, group.width, group.height, 18);
      ctx.stroke();

      if (s > 0.2) {
        ctx.setLineDash([]);
        ctx.fillStyle = group.kind === 'isolated' ? c.brass : c.inkFaint;
        ctx.font = `500 ${13 / s}px "JetBrains Mono", ui-monospace, monospace`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        const label = group.kind === 'isolated'
          ? `Not connected to anyone · ${group.count} ${group.count === 1 ? 'person' : 'people'}`
          : `${group.count} people · ${group.generations} generation${group.generations === 1 ? '' : 's'}`;
        ctx.fillText(label, group.x + 2, group.y - 8 / s);
      }
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  drawDescents(ctx, c, view, s) {
    ctx.save();
    ctx.strokeStyle = c.rule;
    ctx.lineWidth = 1.4 / s;
    ctx.lineCap = 'butt';
    for (const link of this.layout.descents) {
      if (link.busY < view.y0 - 200 || link.originY > view.y1 + 200) continue;
      const xs = link.childXs;
      const minX = Math.min(link.originX, ...xs);
      const maxX = Math.max(link.originX, ...xs);
      if (maxX < view.x0 - 200 || minX > view.x1 + 200) continue;

      ctx.beginPath();
      // Down from between the parents, across the children, then down to each.
      ctx.moveTo(link.originX, link.originY);
      ctx.lineTo(link.originX, link.busY);
      ctx.moveTo(minX, link.busY);
      ctx.lineTo(maxX, link.busY);
      for (let i = 0; i < xs.length; i++) {
        ctx.moveTo(xs[i], link.busY);
        ctx.lineTo(xs[i], link.childYs[i]);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /*
   * Siblings whose shared parents are unknown, bracketed above the pair. Dashed on purpose: what
   * joins these two is exactly the part of the record nobody wrote down.
   */
  drawSiblings(ctx, c, view, s) {
    if (!this.layout.siblings?.length) return;
    ctx.save();
    ctx.strokeStyle = c.rule;
    ctx.lineWidth = 1.4 / s;
    ctx.setLineDash([6 / s, 5 / s]);
    const lift = 20;
    for (const link of this.layout.siblings) {
      if (link.y < view.y0 - 80 || link.y > view.y1 + 80
        || link.x2 < view.x0 - 80 || link.x1 > view.x1 + 80) continue;
      ctx.beginPath();
      ctx.moveTo(link.x1, link.y);
      ctx.lineTo(link.x1, link.y - lift);
      ctx.lineTo(link.x2, link.y - lift);
      ctx.lineTo(link.x2, link.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  drawCouples(ctx, c, view, s) {
    ctx.save();
    ctx.strokeStyle = c.spouseLink;
    ctx.lineWidth = 1.6 / s;
    const offset = 3;
    for (const link of this.layout.couples) {
      if (link.y < view.y0 - 40 || link.y > view.y1 + 40
        || link.x2 < view.x0 - 40 || link.x1 > view.x1 + 40) continue;
      // A doubled rule, the app's notation for a marriage; dashed when it has ended.
      ctx.setLineDash(link.subtype === 'DIVORCED' ? [5 / s, 4 / s] : []);
      ctx.beginPath();
      ctx.moveTo(link.x1, link.y - offset);
      ctx.lineTo(link.x2, link.y - offset);
      ctx.moveTo(link.x1, link.y + offset);
      ctx.lineTo(link.x2, link.y + offset);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  drawNodes(ctx, c, view, s) {
    const { NODE_W, NODE_H } = this.layout.metrics;
    const showNames = s >= TIER.NAMES;
    const showDates = s >= TIER.DATES;
    const showPhotos = this.showPhotos && s >= TIER.PHOTOS;
    const dimming = Boolean(this.related);

    ctx.save();
    ctx.lineJoin = 'round';

    for (const node of this.layout.nodes) {
      if (node.x > view.x1 || node.x + NODE_W < view.x0
        || node.y > view.y1 || node.y + NODE_H < view.y0) continue;

      const person = this.graph.people.get(node.id);
      const unknown = !person.name;
      const isSelected = node.id === this.selected;
      const onPath = this.pathIds?.has(node.id);
      const isRelated = !dimming || this.related.has(node.id);
      const isMatch = this.matches?.has(node.id);

      ctx.globalAlpha = isRelated || onPath ? 1 : 0.28;

      // Fill and border. An unknown person keeps the app's dashed brass edge at every scale, so
      // the holes in a record stay visible even when the chart is too small to read.
      ctx.fillStyle = isSelected ? c.sageContainer : unknown ? c.brassSurface : c.raised;
      roundRect(ctx, node.x, node.y, NODE_W, NODE_H, 10);
      ctx.fill();

      ctx.setLineDash(unknown ? [7, 5] : []);
      ctx.strokeStyle = onPath ? c.brass : isSelected ? c.forest : unknown ? c.brass : c.rule;
      ctx.lineWidth = isSelected || onPath ? 3 : 1.4;
      ctx.stroke();
      ctx.setLineDash([]);

      /*
       * A memorial rule across the top for somebody no longer living.
       *
       * Deliberately not a dotted or dashed outline: a broken perimeter already means "name not
       * known" here, and one visual idea cannot carry two unrelated meanings on the same chart.
       * It also has to compose - a person can be unnamed and dead, and that reads as a dashed
       * brass edge with a rule across the top rather than two dash patterns fighting.
       *
       * Drawn before the zoom check, so it survives to the scale where cards are plain shapes and
       * the chart still shows which generations have passed.
       */
      if (person.deceased) {
        ctx.strokeStyle = c.inkFaint;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(node.x + 9, node.y + 3);
        ctx.lineTo(node.x + NODE_W - 9, node.y + 3);
        ctx.stroke();
      }

      if (isMatch && !isSelected) {
        ctx.strokeStyle = c.forest;
        ctx.lineWidth = 2.5;
        roundRect(ctx, node.x - 4, node.y - 4, NODE_W + 8, NODE_H + 8, 13);
        ctx.stroke();
      }

      if (!showNames) continue;

      let textX = node.x + 14;
      let textWidth = NODE_W - 28;

      if (showPhotos && person.photo) {
        const bitmap = this.photos.get(person.photo);
        if (bitmap === undefined) this.requestPhoto(person.photo);
        const size = 40;
        const cx = node.x + 12 + size / 2;
        const cy = node.y + NODE_H / 2;
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        if (bitmap) {
          ctx.drawImage(bitmap, cx - size / 2, cy - size / 2, size, size);
        } else {
          ctx.fillStyle = unknown ? c.brassSurface : c.sageContainer;
          ctx.fill();
          ctx.fillStyle = unknown ? c.brass : c.forest;
          ctx.font = `600 15px Literata, Georgia, serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(initials(person), cx, cy + 1);
        }
        ctx.restore();
        textX = node.x + 12 + size + 12;
        textWidth = NODE_W - (textX - node.x) - 12;
      }

      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';

      const name = displayName(person);
      ctx.font = unknown
        ? `italic 600 16px Literata, Georgia, serif`
        : `600 16px Literata, Georgia, serif`;
      ctx.fillStyle = unknown ? c.brass : c.ink;
      const dates = showDates ? lifespan(person) : '';
      const nameY = node.y + (dates ? NODE_H / 2 - 2 : NODE_H / 2 + 6);
      ctx.fillText(this.ellipsise(ctx, name, textWidth, 'n'), textX, nameY);

      if (dates) {
        ctx.font = `400 12.5px "JetBrains Mono", ui-monospace, monospace`;
        ctx.fillStyle = c.inkFaint;
        ctx.fillText(this.ellipsise(ctx, dates, textWidth, 'd'), textX, nameY + 18);
      }
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  }
}
