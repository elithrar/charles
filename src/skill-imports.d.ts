declare module '*.md' {
  const skill: import('@flue/runtime').SkillReference;
  export default skill;
}

declare module '*.md?raw' {
  const text: string;
  export default text;
}

declare module '@cloudflare/kumo/styles/standalone?raw' {
  const styles: string;
  export default styles;
}
