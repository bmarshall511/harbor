'use client';

import dynamic from 'next/dynamic';
import { useQuery } from '@tanstack/react-query';
import { connections } from '@/lib/api';
import { Loader2, Network, Settings } from 'lucide-react';
import { useRouter } from 'next/navigation';

const ConnectionsGraph = dynamic(
  () => import('@/components/connections-graph'),
  { ssr: false },
);

export default function ConnectionsPage() {
  const router = useRouter();

  const { data, isLoading } = useQuery({
    queryKey: ['connections'],
    queryFn: connections.graph,
    staleTime: 60_000,
  });

  const hasRelationships = (data?.edges.length ?? 0) > 0;
  const hasNodes = (data?.nodes.length ?? 0) > 0;

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!hasNodes || !hasRelationships) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="max-w-sm text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
            <Network className="h-7 w-7 text-primary" />
          </div>
          <h2 className="mt-4 text-lg font-semibold">No connections yet</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {!hasNodes
              ? 'Add people or pets in Settings to start building your relationship graph.'
              : 'Add relationships between people in Settings to visualize your connections.'}
          </p>
          <button
            type="button"
            onClick={() => router.push('/settings?s=people')}
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Settings className="h-4 w-4" />
            Go to People Settings
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full">
      <ConnectionsGraph nodes={data!.nodes} edges={data!.edges} groups={data!.groups ?? []} />
    </div>
  );
}
