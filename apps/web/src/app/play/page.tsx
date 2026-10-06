import { Workspace } from '@/features/Workspace';

export default async function PlayPage({ searchParams }: { searchParams: Promise<{ template?: string; interview?: string }> }) {
  const { template, interview } = await searchParams;
  return <Workspace template={template} interview={interview} />;
}
