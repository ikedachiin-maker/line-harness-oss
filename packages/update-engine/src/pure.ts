export type {
  CurrentVersion,
  ForkStatus,
  Manifest,
  ReleaseEntry,
} from './types.js';
export {
  compareSemver,
  fetchManifest,
  findLatestUpgrade,
  findRelease,
} from './manifest.js';
export { detectFork } from './fork-detect.js';
