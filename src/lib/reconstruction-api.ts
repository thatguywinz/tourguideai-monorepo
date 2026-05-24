/**
 * External 3D Reconstruction API interface.
 * 
 * This module defines the contract for communicating with an external
 * reconstruction service. Currently uses mock responses for development.
 * Replace the mock implementations with real API calls when ready.
 */

export interface ReconstructionJob {
  id: string;
  status: 'uploading' | 'estimating' | 'building' | 'optimizing' | 'ready' | 'failed';
  progress: number; // 0-100
  sceneUrl?: string;
  thumbnailUrl?: string;
  error?: string;
}

const STAGE_PROGRESS: Record<string, number> = {
  uploading: 15,
  estimating: 35,
  building: 65,
  optimizing: 85,
  ready: 100,
  failed: 0,
};

const STAGE_ORDER: ReconstructionJob['status'][] = [
  'uploading', 'estimating', 'building', 'optimizing', 'ready',
];

/**
 * Upload room media files to the reconstruction service.
 * Returns an array of stored file paths.
 */
export async function uploadRoomMedia(
  _roomId: string,
  _files: File[],
  _onProgress?: (pct: number) => void,
): Promise<string[]> {
  // MOCK: simulate upload delay
  await new Promise(r => setTimeout(r, 1500));
  _onProgress?.(100);
  return _files.map((f, i) => `mock-media/${_roomId}/${i}-${f.name}`);
}

/**
 * Create a reconstruction job for a room.
 * Returns the external job ID.
 */
export async function createReconstructionJob(
  _roomId: string,
  _mediaPaths: string[],
): Promise<string> {
  // MOCK: return a fake job ID
  await new Promise(r => setTimeout(r, 500));
  return `job-${_roomId}-${Date.now()}`;
}

/**
 * Poll the status of a reconstruction job.
 */
export async function pollJobStatus(externalJobId: string): Promise<ReconstructionJob> {
  // MOCK: simulate progressive status based on time since job creation
  const timestamp = parseInt(externalJobId.split('-').pop() || '0');
  const elapsed = (Date.now() - timestamp) / 1000; // seconds

  let status: ReconstructionJob['status'] = 'uploading';
  if (elapsed > 25) status = 'ready';
  else if (elapsed > 18) status = 'optimizing';
  else if (elapsed > 10) status = 'building';
  else if (elapsed > 4) status = 'estimating';

  const result: ReconstructionJob = {
    id: externalJobId,
    status,
    progress: STAGE_PROGRESS[status],
  };

  if (status === 'ready') {
    // In production, these would be real URLs to GLB files and thumbnails
    result.sceneUrl = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/Box/glTF-Binary/Box.glb';
    result.thumbnailUrl = '/placeholder.svg';
  }

  return result;
}

/**
 * Get the stage label for display.
 */
export function getStageLabel(status: ReconstructionJob['status']): string {
  switch (status) {
    case 'uploading': return 'Uploading media…';
    case 'estimating': return 'Estimating camera positions…';
    case 'building': return 'Building 3D room…';
    case 'optimizing': return 'Optimizing scene…';
    case 'ready': return 'Ready!';
    case 'failed': return 'Failed';
    default: return 'Processing…';
  }
}

/**
 * Get ordered stages for progress display.
 */
export function getStages() {
  return STAGE_ORDER.map(s => ({
    key: s,
    label: getStageLabel(s),
    progress: STAGE_PROGRESS[s],
  }));
}
