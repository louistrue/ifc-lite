# IFC-Lite: Honest Project Materials

## The One-Liner

> "A streaming IFC engine for the browser. Load huge files fast, query with SQL, export to anything."

---

## The README (for GitHub)

```markdown
# IFC-Lite

A modern IFC parser and query engine for the browser.

## Why?

Existing tools make you wait. IFC-Lite streams.

| 100MB IFC file | Traditional | IFC-Lite (Tier 2) |
|----------------|-------------|-------------------|
| First geometry | 10-30s | 3-5s |
| Full load | 30-60s | 10-20s |
| Memory | 2-4GB | 800MB-1.8GB |
| Query 100K properties | 500ms+ | <15ms |

*Performance varies by complexity tier. See plan docs for details.*

## What's Different

- **Streaming parser** - See geometry while loading
- **Columnar storage** - Fast queries on big data
- **SQL support** - Query with DuckDB-WASM
- **Standards export** - Parquet, Arrow, glTF
- **Tree-shakeable** - Take only what you need

## Status

🚧 **Early development** - Not ready for production.

Following progress? Star the repo or check the [dev log](./DEVLOG.md).

## Quick Example

```typescript
import { IfcParser } from 'ifc-lite';

// Stream a large file
const parser = new IfcParser();

for await (const event of parser.stream(file)) {
  if (event.type === 'geometry') {
    viewer.add(event.mesh);  // Show immediately
  }
}

// Query with SQL
const result = await model.sql(`
  SELECT type, COUNT(*) as count, SUM(area) as total_area
  FROM elements
  WHERE type LIKE 'IfcWall%'
  GROUP BY type
`);
```

## Roadmap

- [x] Feasibility spikes
- [ ] Streaming parser (in progress)
- [ ] Columnar property store
- [ ] Geometry pipeline (CSG, openings, profiles)
- [ ] Query engine (fluent API, SQL, graph)
- [ ] Export formats (Parquet, glTF, Arrow)
- [ ] IFC version compatibility (IFC2X3/4/4X3)
- [ ] Viewer integration

## License

MIT

## Author

Built by [Louis](https://github.com/...) at [Ltplus AG](https://ltplus.ch).

Questions? Open an issue or email louis@ltplus.ch.
```

---

## The Dev Log Format

Instead of marketing, **document the journey**. This builds credibility and attracts collaborators.

```markdown
# IFC-Lite Dev Log

## 2026-01-15: Parsing Speed Spike

**Question:** Can we scan 100MB in <1s?

**Approach:** Simple byte scanner looking for entity markers.

**Result:** 
- 100MB indexed in 870ms ✓
- 500MB indexed in 4.3s ✓
- Memory: ~50MB overhead for index

**Code:**
[link to spike code]

**Next:** Test with actual entity parsing. Full geometry depends on complexity tier.

---

## 2026-01-18: Geometry Coverage Test

**Question:** What % of geometry can we triangulate?

**Approach:** Run web-ifc on 10 test files, count successes.

**Result:**
| File | Elements | Success | Failed | Coverage |
|------|----------|---------|--------|----------|
| Duplex | 2,341 | 2,298 | 43 | 98.2% |
| Office | 45,231 | 43,102 | 2,129 | 95.3% |
| Hospital | 234,521 | 198,234 | 36,287 | 84.5% |

**Failed types:** IfcBSplineSurface (32%), IfcAdvancedBrep (28%)

**Learning:** Complex NURBS geometry is the gap. Most buildings are fine.

**Next:** Investigate Manifold for boolean operations.

---

## 2026-01-22: WebGPU Instancing Test

**Question:** How many instances can we draw efficiently?

...
```

---

## The Twitter/X Thread Format

When you have something to show:

```
🧵 I'm building an IFC parser that doesn't make you wait.

Current state of IFC in browsers:
- Drop 100MB file
- Wait 30 seconds
- Hope it doesn't crash

What I'm trying:
- Stream parse (see geometry in 2s)
- Columnar storage (query 100K props in 20ms)
- SQL support (yes, really)

1/6

---

Here's a 100MB hospital model loading.

Left: Traditional (web-ifc)
Right: Streaming approach

[video comparison]

Not magic - just parsing smarter.

2/6

---

The key insight: IFC files have forward references.

Entity #100 might reference #50000.

Traditional: Parse everything, resolve, then render.
Streaming: Parse structure first, resolve lazily, render immediately.

3/6

---

For queries, I'm using columnar storage.

Instead of:
walls = [{id: 1, height: 3.0}, {id: 2, height: 2.8}, ...]

I store:
ids = [1, 2, 3, ...]
heights = [3.0, 2.8, 3.0, ...]

Typed arrays + cache locality = fast filtering.

4/6

---

Wild part: DuckDB-WASM for SQL.

SELECT type, COUNT(*), SUM(area)
FROM elements
GROUP BY type

On 100K elements: 15ms.

Building data is just... data. Why not query it properly?

5/6

---

Still early. Lots of hard problems:
- Boolean geometry (wall minus openings)
- LOD generation
- Memory management
- WebGPU compatibility

If this interests you, I'm documenting everything:
[link to repo/devlog]

Not looking for stars. Looking for feedback.

6/6
```

---

## The LinkedIn Post Format

More professional tone, same honesty:

```
I've been working on a problem that's bothered me for years.

IFC files are the standard for building data. Every architect, 
engineer, and contractor uses them. But loading them in a browser 
is painful - wait 30 seconds, watch memory climb, hope it works.

I'm building something different: a streaming IFC engine.

The idea is simple:
→ Start showing geometry after 2 seconds, not 30
→ Let users navigate while loading continues
→ Query properties with SQL, not custom loops
→ Export to standard formats (Parquet, Arrow, glTF)

Why am I sharing this now? It's not done. Not even close.

But I've learned that building in public attracts the right people.
People who've hit the same problems. People with ideas I haven't had.

If you work with IFC files and this resonates, I'd love to hear 
what problems you're facing. What would make your workflow better?

Not selling anything. Just building and learning.

#BIM #OpenBIM #IFC #WebDev
```

---

## The Conference Talk Pitch

If you want to speak at conferences (BlenderBIM, BuildingSMART, etc.):

```
Title: "Streaming IFC: What If Loading Didn't Mean Waiting?"

Abstract:
IFC files are getting larger. Buildings are getting more complex. 
But our loading model is still "parse everything, then show."

This talk explores a different approach:
- Streaming parsing that shows geometry progressively
- Columnar storage for fast property queries
- SQL as an interface for building data
- WebGPU for rendering millions of triangles

I'll share what worked, what failed, and what I learned building 
an experimental IFC engine from scratch.

No product pitch. Just technical exploration and honest results.

Format: 20 min talk + 10 min discussion
Audience: Developers working with BIM/IFC data
```

---

## The "About" Page for a Project Site

```markdown
# About IFC-Lite

## What is this?

IFC-Lite is an experimental IFC parser and query engine for the browser.

It's not a product. It's not a company. It's one developer exploring 
whether IFC tooling can be better.

## Who's building it?

I'm Louis, founder of Ltplus AG in Zürich. We build BIM tools 
(ifcrender.com, modelhealthcheck.com, etc.) and I teach digital 
construction at BFH.

I started this because every product I build has the same problem: 
loading IFC files is slow and querying them is awkward.

## Why not use existing libraries?

web-ifc is great for triangulation. Fragments is great for viewing. 
Neither is designed for streaming, SQL queries, or analytics export.

I'm not trying to replace them. I'm exploring a different part 
of the problem space.

## Is it ready to use?

No. It's early research. Things break. APIs change. 

If you want stable, use web-ifc.

If you want to follow the experiment, watch the repo.

## Can I help?

Maybe. I'm not looking for contributors yet - the architecture is 
still fluid. But I am looking for:

- Feedback on the approach
- Test files (especially complex ones that break things)
- Use cases I haven't considered

Email: louis@ltplus.ch
GitHub: [link]
```

---

## The Email Template (for reaching out to potential users)

```
Subject: Quick question about IFC loading in your tools

Hi [Name],

I saw [your project/talk/post about X] and thought you might 
have opinions on this.

I'm working on an IFC parser that prioritizes streaming - showing 
geometry in ~2 seconds instead of making users wait for full load.

I'm not pitching anything (it's not even usable yet). I'm trying 
to understand if the problems I'm solving are problems others have.

Quick questions if you have 2 minutes:
1. What's the largest IFC file you typically work with?
2. What's most frustrating about current IFC tools?
3. Do you ever need to query properties across the whole model?

No need for a call - a quick reply is plenty.

Thanks,
Louis

P.S. Here's a 30-second video of the streaming approach if you're curious: [link]
```

---

## What NOT to Do

```
❌ DON'T: "Revolutionary AI-powered BIM platform"
✓ DO: "IFC parser with streaming support"

❌ DON'T: "10x faster than competitors"
✓ DO: "First geometry in 2s instead of 30s on our test files"

❌ DON'T: "The future of BIM"
✓ DO: "Exploring whether streaming helps with large IFC files"

❌ DON'T: Hide that you're one person
✓ DO: "Built by one developer, feedback welcome"

❌ DON'T: Promise features that don't exist
✓ DO: "Roadmap: X done, Y in progress, Z planned"

❌ DON'T: Bash existing tools
✓ DO: "web-ifc is great for X, I'm exploring Y"
```

---

## The Metrics to Track (Honestly)

```
MEANINGFUL:
- GitHub stars (interest)
- Issues opened (engagement)
- Forks (serious interest)
- Emails received (real conversations)
- Test files contributed (community trust)
- Dev log views (people following along)

VANITY (ignore):
- Twitter impressions
- LinkedIn views
- "Looks cool!" comments with no follow-up
```

---

## Summary

The best "marketing" for a solo technical project:

1. **Build in public** - Dev log, progress videos
2. **Be honest** - Status, limitations, trade-offs
3. **Show, don't tell** - Working demos beat descriptions
4. **Ask questions** - Learn from potential users
5. **Make it easy to follow** - Star repo, email updates
6. **Don't oversell** - Under-promise, over-deliver

You're not selling a product. You're inviting people into a technical exploration. The right people will find that more compelling than any marketing.