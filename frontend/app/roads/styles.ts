import type { RoadNetworkStyle } from "../api";

export type RoadStyleCard = {
  id: RoadNetworkStyle;
  name: string;
  description: string;
  accent: string;
};

export const ROAD_STYLE_CARDS: RoadStyleCard[] = [
  {
    id: "blueprint",
    name: "Blueprint Roads",
    description: "Deep blue prints with crisp gold arteries and clean geometry.",
    accent: "linear-gradient(135deg, #0b1a33 0%, #f7d66c 120%)",
  },
  {
    id: "gold",
    name: "Gold on Black",
    description: "Warm amber networks on a near-black canvas with a subtle glow.",
    accent: "linear-gradient(135deg, #050505 0%, #f1b45a 120%)",
  },
  {
    id: "ink",
    name: "Ink Atlas",
    description: "Off-white paper with dense, delicate ink lines and atlas texture.",
    accent: "linear-gradient(135deg, #f5f1e8 0%, #2a2a2a 120%)",
  },
];
