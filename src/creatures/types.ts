import type * as THREE from 'three';
import type { TerrainSystem } from '../world/TerrainSystem';
import type { WaterSurfaceSimulation } from '../water/WaterSurfaceSimulation';
import type { Reef, Obstacle } from '../world/Reef';
import type { FoodSystem } from './FoodSystem';
import type { FlowField } from '../world/FlowField';

/** Everything creatures may sense about their environment. */
export interface WorldContext {
  terrain: TerrainSystem;
  water: WaterSurfaceSimulation;
  reef: Reef;
  food: FoodSystem;
  /** Painted water currents (Current Brush). */
  flow: FlowField;
  /** Static + selectable obstacles (live positions). */
  obstacles(): Obstacle[];
  /** Big creatures as spheres (refreshed every frame by the CreatureManager). */
  creatureObstacles: Obstacle[];
  /** Horizontal range currently visible on screen. */
  visibleX: { min: number; max: number };
  onEat?: (p: THREE.Vector3) => void;
  /** Visual feedback hooks (sand dust puffs, bubbles). */
  fx?: { dust(x: number, y: number, z: number, n: number): void; bubbles(x: number, y: number, z: number, n: number): void };
}
