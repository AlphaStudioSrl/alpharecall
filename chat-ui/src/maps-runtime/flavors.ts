import { namedFlavor, type Flavor } from "@protomaps/basemaps";

/**
 * Soft, low-contrast basemaps tuned to the widget surfaces (like CARTO
 * Positron / Dark Matter): a quiet gray-green ground, parks one step darker,
 * roads as plain light (or, in dark mode, recessed) strokes and muted labels,
 * so the brand-colored pin is the only accent on the card.
 */

const LIGHT_LAND = "#e6eae7";
const LIGHT_GREEN = "#ccd8d2";
const LIGHT_ROAD = "#ffffff";
const LIGHT_CASING = LIGHT_LAND;

const DARK_LAND = "#222a27";
const DARK_GREEN = "#2c3f38";
const DARK_ROAD = "#171b1a";
const DARK_CASING = DARK_LAND;

function fill(keys: (keyof Flavor)[], color: string): Partial<Flavor> {
  return Object.fromEntries(keys.map((key) => [key, color]));
}

const GROUND: (keyof Flavor)[] = [
  "background", "earth", "hospital", "industrial", "school", "pedestrian", "glacier",
  "sand", "beach", "aerodrome", "military", "zoo",
];
const GREEN: (keyof Flavor)[] = ["park_a", "park_b", "wood_a", "wood_b", "scrub_a", "scrub_b"];
const ROADS: (keyof Flavor)[] = [
  "other", "minor_service", "minor_a", "minor_b", "link", "major", "highway",
  "bridges_other", "bridges_minor", "bridges_link", "bridges_major", "bridges_highway",
  "tunnel_other", "tunnel_minor", "tunnel_link", "tunnel_major", "tunnel_highway", "pier", "runway",
];
const CASINGS: (keyof Flavor)[] = [
  "minor_service_casing", "minor_casing", "link_casing", "major_casing_late", "highway_casing_late",
  "major_casing_early", "highway_casing_early",
  "bridges_other_casing", "bridges_minor_casing", "bridges_link_casing", "bridges_major_casing",
  "bridges_highway_casing",
  "tunnel_other_casing", "tunnel_minor_casing", "tunnel_link_casing", "tunnel_major_casing",
  "tunnel_highway_casing",
];

const LIGHT: Flavor = {
  ...namedFlavor("light"),
  ...fill(GROUND, LIGHT_LAND),
  ...fill(GREEN, LIGHT_GREEN),
  ...fill(ROADS, LIGHT_ROAD),
  ...fill(CASINGS, LIGHT_CASING),
  water: "#cbdbe0",
  buildings: "#dde2df",
  railway: "#c3cbc7",
  boundaries: "#b3bbb7",
  roads_label_minor: "#8d9692", roads_label_minor_halo: LIGHT_ROAD,
  roads_label_major: "#87908c", roads_label_major_halo: LIGHT_ROAD,
  ocean_label: "#7f979f",
  subplace_label: "#8d9692", subplace_label_halo: LIGHT_LAND,
  city_label: "#5d6662", city_label_halo: LIGHT_LAND,
  state_label: "#a7afab", state_label_halo: LIGHT_LAND,
  country_label: "#98a19d",
  address_label: "#9aa29e", address_label_halo: LIGHT_LAND,
};

const DARK: Flavor = {
  ...namedFlavor("dark"),
  ...fill(GROUND, DARK_LAND),
  ...fill(GREEN, DARK_GREEN),
  ...fill(ROADS, DARK_ROAD),
  ...fill(CASINGS, DARK_CASING),
  water: "#1a2327",
  buildings: "#1e2522",
  railway: "#141716",
  boundaries: "#46504c",
  roads_label_minor: "#68736e", roads_label_minor_halo: DARK_LAND,
  roads_label_major: "#76817c", roads_label_major_halo: DARK_LAND,
  ocean_label: "#5e7076",
  subplace_label: "#68736e", subplace_label_halo: DARK_LAND,
  city_label: "#93a09a", city_label_halo: DARK_LAND,
  state_label: "#4f5a55", state_label_halo: DARK_LAND,
  country_label: "#6c7772",
  address_label: "#5f6a65", address_label_halo: DARK_LAND,
};

export function widgetFlavor(name: "light" | "dark"): Flavor {
  return name === "dark" ? DARK : LIGHT;
}
