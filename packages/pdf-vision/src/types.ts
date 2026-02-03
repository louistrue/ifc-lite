/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Core types for floor plan recognition and 3D building reconstruction
 */

export interface Point2D {
  x: number;
  y: number;
}

export interface DetectedLine {
  start: Point2D;
  end: Point2D;
  thickness: number;
  confidence: number;
}

export type WallType = 'Exterior' | 'Interior' | 'Unknown';

export interface DetectedWall {
  centerline: Point2D[];
  thickness: number;
  wall_type: WallType;
  confidence: number;
}

export type OpeningType = 'Door' | 'Window' | 'Unknown';

export interface DetectedOpening {
  position: Point2D;
  width: number;
  opening_type: OpeningType;
  host_wall_index: number;
}

export interface DetectedRoom {
  boundary: Point2D[];
  area: number;
  label?: string;
}

export interface DetectedFloorPlan {
  page_index: number;
  walls: DetectedWall[];
  openings: DetectedOpening[];
  rooms: DetectedRoom[];
  scale: number;
  image_width: number;
  image_height: number;
}

export interface DetectionConfig {
  blur_kernel_size: number;
  threshold_block_size: number;
  threshold_c: number;
  canny_low: number;
  canny_high: number;
  hough_threshold: number;
  min_line_length: number;
  max_line_gap: number;
  collinear_angle_tolerance: number;
  collinear_distance_tolerance: number;
  min_wall_length: number;
  default_wall_thickness: number;
  min_room_area: number;
}

export const DEFAULT_DETECTION_CONFIG: DetectionConfig = {
  blur_kernel_size: 3,
  threshold_block_size: 11,
  threshold_c: 2.0,
  canny_low: 50.0,
  canny_high: 150.0,
  hough_threshold: 50,
  min_line_length: 30.0,
  max_line_gap: 10.0,
  collinear_angle_tolerance: 0.087,
  collinear_distance_tolerance: 8.0,
  min_wall_length: 50.0,
  default_wall_thickness: 15.0,
  min_room_area: 10000.0,
};

export interface StoreyConfig {
  id: string;
  label: string;
  height: number;
  elevation: number;
  order: number;
  floor_plan_index: number;
}

export interface BuildingBounds {
  min_x: number;
  min_y: number;
  max_x: number;
  max_y: number;
}

export interface GeneratedStorey {
  config: StoreyConfig;
  wall_count: number;
  positions: number[];
  normals: number[];
  indices: number[];
}

export interface GeneratedBuilding {
  total_height: number;
  bounds: BuildingBounds;
  storeys: GeneratedStorey[];
}

export interface StoreyMeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  wallCount: number;
  label: string;
  elevation: number;
  height: number;
}
