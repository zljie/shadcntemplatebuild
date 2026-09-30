// Provisional theme: no approved enterprise design specification has been supplied.
export const themeVersion = "provisional-0.1.0";
export const spacing = ["space.0", "space.2", "space.3", "space.4", "space.6", "space.8"] as const;
export const tokenOptions = {
  surface: ["color.surface", "color.muted"],
  radius: ["radius.sm", "radius.md", "radius.lg"],
} as const;
type Token = typeof spacing[number] | typeof tokenOptions.surface[number] | typeof tokenOptions.radius[number];
export const tokenValues: Record<Token, string> = {
  "space.0": "var(--space-0)", "space.2": "var(--space-2)",
  "space.3": "var(--space-3)", "space.4": "var(--space-4)",
  "space.6": "var(--space-6)", "space.8": "var(--space-8)",
  "color.surface": "var(--surface)", "color.muted": "var(--surface-muted)",
  "radius.sm": "var(--dsl-radius-sm)", "radius.md": "var(--dsl-radius-md)", "radius.lg": "var(--dsl-radius-lg)",
};
