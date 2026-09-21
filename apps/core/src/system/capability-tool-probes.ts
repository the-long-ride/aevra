import type { SystemToolCategory } from '../../../../packages/protocol/src/index.js';

export type Candidate = readonly [
  executable: string,
  args: readonly string[],
  reportedExecutable?: string,
];
export interface ToolProbe {
  id: string;
  label: string;
  category: SystemToolCategory;
  candidates: readonly Candidate[];
}

export const TOOL_PROBES: readonly ToolProbe[] = [
  { id: 'git', label: 'Git', category: 'source-control', candidates: [['git', ['--version']]] },
  {
    id: 'gh',
    label: 'GitHub CLI',
    category: 'source-control',
    candidates: [['gh', ['--version']]],
  },
  {
    id: 'glab',
    label: 'GitLab CLI',
    category: 'source-control',
    candidates: [['glab', ['--version']]],
  },
  { id: 'node', label: 'Node.js', category: 'javascript', candidates: [['node', ['--version']]] },
  { id: 'npm', label: 'npm', category: 'javascript', candidates: [['npm', ['--version']]] },
  { id: 'npx', label: 'npx', category: 'javascript', candidates: [['npx', ['--version']]] },
  { id: 'pnpm', label: 'pnpm', category: 'javascript', candidates: [['pnpm', ['--version']]] },
  { id: 'yarn', label: 'Yarn', category: 'javascript', candidates: [['yarn', ['--version']]] },
  { id: 'bun', label: 'Bun', category: 'javascript', candidates: [['bun', ['--version']]] },
  { id: 'rtk', label: 'RTK', category: 'native', candidates: [['rtk', ['--version']]] },
  {
    id: 'python',
    label: 'Python',
    category: 'python',
    candidates: [
      ['python', ['--version']],
      ['python3', ['--version']],
    ],
  },
  {
    id: 'pip',
    label: 'pip',
    category: 'python',
    candidates: [
      ['pip', ['--version']],
      ['pip3', ['--version']],
    ],
  },
  { id: 'uv', label: 'uv', category: 'python', candidates: [['uv', ['--version']]] },
  { id: 'dotnet', label: '.NET', category: 'dotnet', candidates: [['dotnet', ['--version']]] },
  { id: 'cargo', label: 'Cargo', category: 'rust', candidates: [['cargo', ['--version']]] },
  { id: 'rustc', label: 'Rust', category: 'rust', candidates: [['rustc', ['--version']]] },
  { id: 'go', label: 'Go', category: 'go', candidates: [['go', ['version']]] },
  { id: 'java', label: 'Java', category: 'jvm', candidates: [['java', ['-version']]] },
  { id: 'javac', label: 'javac', category: 'jvm', candidates: [['javac', ['-version']]] },
  { id: 'mvn', label: 'Maven', category: 'jvm', candidates: [['mvn', ['--version']]] },
  { id: 'gradle', label: 'Gradle', category: 'jvm', candidates: [['gradle', ['--version']]] },
  { id: 'ruby', label: 'Ruby', category: 'ruby', candidates: [['ruby', ['--version']]] },
  { id: 'gem', label: 'RubyGems', category: 'ruby', candidates: [['gem', ['--version']]] },
  { id: 'php', label: 'PHP', category: 'php', candidates: [['php', ['--version']]] },
  { id: 'composer', label: 'Composer', category: 'php', candidates: [['composer', ['--version']]] },
  { id: 'gcc', label: 'GCC', category: 'native', candidates: [['gcc', ['--version']]] },
  { id: 'g++', label: 'G++', category: 'native', candidates: [['g++', ['--version']]] },
  { id: 'clang', label: 'Clang', category: 'native', candidates: [['clang', ['--version']]] },
  { id: 'cmake', label: 'CMake', category: 'native', candidates: [['cmake', ['--version']]] },
  { id: 'make', label: 'Make', category: 'native', candidates: [['make', ['--version']]] },
  {
    id: 'docker',
    label: 'Docker',
    category: 'containers',
    candidates: [['docker', ['--version']]],
  },
  {
    id: 'podman',
    label: 'Podman',
    category: 'containers',
    candidates: [['podman', ['--version']]],
  },
];
