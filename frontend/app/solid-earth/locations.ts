export type FeaturedLocation = {
  id: string;
  name: string;
  description: string;
  thumbnail: string;
  center: { lat: number; lon: number };
  presetId?: string;
};

export const SOLID_EARTH_LOCATIONS: FeaturedLocation[] = [
  {
    id: "namibia-sand",
    name: "Namibia Sand Cascade",
    description: "Rippling dunes and mineral hues along the Namib Desert.",
    thumbnail: "https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=600&q=80",
    center: { lat: -24.5, lon: 15.3 },
    presetId: "square",
  },
  {
    id: "iceland-lava",
    name: "Iceland Lava Curtain",
    description: "Basalt textures and icy rivers carving volcanic fields.",
    thumbnail: "https://images.unsplash.com/photo-1476610182048-b716b8518aae?auto=format&fit=crop&w=600&q=80",
    center: { lat: 64.85, lon: -17.3 },
    presetId: "poster-landscape",
  },
  {
    id: "red-sea-salt",
    name: "Red Sea Salt Pans",
    description: "Geometric salt pans and turquoise water along the Red Sea.",
    thumbnail: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=600&q=80",
    center: { lat: 19.5, lon: 37.2 },
    presetId: "poster-portrait",
  },
  {
    id: "peru-river",
    name: "Peru River Lacework",
    description: "Braided river channels weaving through Andean foothills.",
    thumbnail: "https://images.unsplash.com/photo-1497906539264-eb74442e37ab?auto=format&fit=crop&w=600&q=80",
    center: { lat: -12.2, lon: -73.2 },
    presetId: "panorama",
  },
];
