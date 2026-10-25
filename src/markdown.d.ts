// Lets TypeScript accept `import text from "./file.md" with { type: "text" }`.
// Bun's bundler turns such imports into a plain string inside dist/extension.js.
declare module "*.md" {
  const content: string;
  export default content;
}
