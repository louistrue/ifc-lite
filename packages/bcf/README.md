# @ifc-lite/bcf

BIM Collaboration Format (BCF) support for IFClite. Implements BCF 2.1 and 3.0 specifications for issue tracking in BIM projects.

## Installation

```bash
npm install @ifc-lite/bcf
```

## Quick Start

```typescript
import { readBCF, createBCFProject, createBCFTopic, addTopicToProject, writeBCF } from '@ifc-lite/bcf';

// Read a BCF file
const project = await readBCF(bcfBuffer);

// Or create a new project
const newProject = createBCFProject({ name: 'My Review', version: '2.1' });
const topic = createBCFTopic({ title: 'Missing fire rating', author: 'user@example.com' });
addTopicToProject(newProject, topic);

// Export (returns Blob)
const blob = await writeBCF(newProject);
```

## Features

- Read/write BCF 2.1 and 3.0 files
- Topics, comments, and viewpoints
- Camera state conversion (viewer <-> BCF format)
- IFC GlobalId <-> UUID conversion utilities
- Component visibility and selection in viewpoints

## API

See the [BCF Guide](../../docs/guide/bcf.md) and [API Reference](../../docs/api/typescript.md#ifc-litebcf).

## License

[MPL-2.0](../../LICENSE)
