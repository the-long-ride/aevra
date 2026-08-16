import { DockerBackend } from './docker.js';
export class PodmanBackend extends DockerBackend {
  readonly id = 'podman' as const;
  protected executable = 'podman';
}
