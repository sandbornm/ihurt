# Performance Baseline & Improvements

## Baseline (Before Optimizations)

### Bundle Sizes (Nov 26, 2026)

| File | Size | Gzipped | Category |
|------|------|---------|----------|
| `three-*.js` | 566.28 kB | 143.95 kB | 3D Engine |
| `index-*.js` | 529.50 kB | 170.26 kB | Main Bundle |
| `vision_bundle-*.js` | 136.11 kB | 40.62 kB | MediaPipe/Hands |
| `DRACOLoader-*.js` | 70.90 kB | 19.97 kB | GLTF Compression |
| `Anatomy-*.js` | 57.74 kB | 20.64 kB | 3D Viewer |
| `index-*.css` | 58.53 kB | 13.14 kB | Styles |
| `icons-*.js` | 16.78 kB | 6.54 kB | Lucide Icons |
| `BodyReference-*.js` | 3.65 kB | 1.70 kB | Layer Picker |

**Total JS:** ~1,381 kB (~388 kB gzipped)  
**Build Time:** 2.56s  
**Warnings:** 2 chunks > 500 kB

### Load Performance

- **First Contentful Paint (FCP):** ~1.2s (estimated, desktop, cached)
- **Time to Interactive (TTI):** ~2.5s (estimated, desktop, all models loaded)
- **Model Loading:** ~11.5 MB progressive (muscular.glb, skeleton.glb)

### Runtime Performance

- **3D Render:** 60 FPS idle, 45-60 FPS during interaction
- **WebAssembly Heat:** <1ms per paint stroke
- **IndexedDB:** <50ms read, <100ms write

## After Optimizations

### Bundle Sizes (After Nov 26, 2026 improvements)

| File | Before | After | Reduction |
|------|--------|-------|-----------|
| Main bundle (gzipped) | 170.26 kB | 101.50 kB | **40%** ⬇️ |
| Main bundle (brotli) | N/A | 85.24 kB | **50%** vs original gzip ⬇️ |
| Three.js | 143.95 kB | 163.06 kB gz | +13% (chunking overhead) |
| **Total initial load** | ~314 kB | **~265 kB** | **16% smaller** ✅ |

### New Code-Split Chunks

| Chunk | Size (gzipped) | Description |
|-------|----------------|-------------|
| Voice | 25.88 kB | Voice recording & extraction |
| Export | 40.80 kB | PDF, JSON, SVG exports |
| Research | 3.49 kB | Reading recommendations |

**Result:** Features now load on-demand, reducing initial bundle by 70 kB.

### Improvements Applied

1. ✅ **Advanced code splitting** - Voice, Export, Research separated
2. ✅ **Brotli compression** - 15-20% better than gzip
3. ✅ **Manual chunks** - Optimized vendor splitting
4. ✅ **Bundle analysis** - `npm run build:analyze` added
5. ✅ **Compression plugins** - Both .gz and .br files generated

### Remaining Opportunities

6. ⚠️ Icon optimization: Import only used Lucide icons
7. ⚠️ Font subsetting: DM Sans reduced to used glyphs  
8. ⚠️ Three.js tree-shaking: Import only used modules
9. ⏸ Model LOD: Lower detail models for preview
10. ⏸ Service worker: Advanced caching strategies

## Measurement Tools

```bash
# Bundle analysis
npm run build:analyze

# Performance audit
npm run lighthouse

# Bundle size comparison
npm run size
```

---

Last measured: 2026-11-26 (main branch)
