/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror agri-web's index.css palette (Mtandeo green + amber
 * brand) so the two artifacts share a cohesive identity. HSL values from
 * the web theme are converted to hex here.
 */

const colors = {
  light: {
    text: "#173626",
    tint: "#265940",

    background: "#f8faf8",
    foreground: "#173626",

    card: "#ffffff",
    cardForeground: "#173626",

    primary: "#265940",
    primaryForeground: "#ffffff",

    secondary: "#f2930d",
    secondaryForeground: "#173626",

    muted: "#edf2f0",
    mutedForeground: "#5c8a73",

    accent: "#e2e9e6",
    accentForeground: "#173626",

    destructive: "#ef4444",
    destructiveForeground: "#ffffff",

    border: "#e0eae6",
    input: "#d1e0d9",
  },

  dark: {
    text: "#f8faf8",
    tint: "#48a37d",

    background: "#172620",
    foreground: "#f8faf8",

    card: "#1f3a2e",
    cardForeground: "#f8faf8",

    primary: "#48a37d",
    primaryForeground: "#ffffff",

    secondary: "#f2930d",
    secondaryForeground: "#173626",

    muted: "#26403a",
    mutedForeground: "#a8bfb6",

    accent: "#2c4a3e",
    accentForeground: "#f8faf8",

    destructive: "#7f1d1d",
    destructiveForeground: "#fafafa",

    border: "#2c4a3e",
    input: "#2c4a3e",
  },

  radius: 8,
};

export default colors;
