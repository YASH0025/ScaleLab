import { Workspace } from '@/features/Workspace';

export default async function PlayPage({ searchParams }: { searchParams: Promise<{ template?: string }> }) {
  const { template } = await searchParams;
  return <Workspace template={template} />;
}
