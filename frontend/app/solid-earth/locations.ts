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
    thumbnail: "https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=900&q=80",
    center: { lat: -24.5, lon: 15.3 },
    presetId: "square",
  },
  {
    id: "iceland-lava",
    name: "Iceland Lava Curtain",
    description: "Basalt textures and icy rivers carving volcanic fields.",
    thumbnail: "https://images.unsplash.com/photo-1476610182048-b716b8518aae?auto=format&fit=crop&w=900&q=80",
    center: { lat: 64.85, lon: -17.3 },
    presetId: "poster-landscape",
  },
  {
    id: "red-sea-salt",
    name: "Red Sea Salt Pans",
    description: "Geometric salt pans and turquoise water along the Red Sea.",
    thumbnail: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80",
    center: { lat: 19.5, lon: 37.2 },
    presetId: "poster-portrait",
  },
  {
    id: "peru-river",
    name: "Peru River Lacework",
    description: "Braided river channels weaving through Andean foothills.",
    thumbnail: "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=900&q=80",
    center: { lat: -12.2, lon: -73.2 },
    presetId: "panorama",
  },
  {
    id: "utah-canyons",
    name: "Utah Canyon Weave",
    description: "Layered sandstone canyons and winding river bends.",
    thumbnail: "https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=900&q=80",
    center: { lat: 37.3, lon: -110.7 },
    presetId: "poster-landscape",
  },
  {
    id: "patagonia-ice",
    name: "Patagonia Ice Flow",
    description: "Glacial tongues meeting turquoise lakes in southern Andes.",
    thumbnail: "https://images.unsplash.com/photo-1469474968028-56623f02e42e?auto=format&fit=crop&w=900&q=80",
    center: { lat: -49.3, lon: -73.0 },
    presetId: "square",
  },
];
