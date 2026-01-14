# create-ifc-lite

Scaffold IFC-Lite projects in seconds.

## Usage

### Create a new project

```bash
npx create-ifc-lite my-ifc-app
```

### Templates

**Basic** (default) - Minimal TypeScript project for parsing IFC files:

```bash
npx create-ifc-lite my-app
cd my-app
npm install
npm run parse ./model.ifc
```

**React** - React + Vite project with drag-and-drop viewer:

```bash
npx create-ifc-lite my-viewer --template react
cd my-viewer
npm install
npm run dev
```

## Options

| Flag | Description |
|------|-------------|
| `--template <type>` | Template to use: `basic`, `react` (default: `basic`) |
| `--help` | Show help |

## Learn More

- [IFC-Lite Documentation](https://louistrue.github.io/ifc-lite/)
- [GitHub Repository](https://github.com/louistrue/ifc-lite)
