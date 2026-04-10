'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { favorites } from '@/lib/api';
import { Heart } from 'lucide-react';
import { cn } from '@/lib/cn';

export function FavoriteButton({ entityType, entityId }: { entityType: 'FILE' | 'FOLDER'; entityId: string }) {
  const queryClient = useQueryClient();

  const { data: allFavorites } = useQuery({
    queryKey: ['favorites'],
    queryFn: favorites.list,
  });

  const isFavorited = allFavorites?.some(
    (f) => f.entityType === entityType && f.entityId === entityId,
  ) ?? false;

  const toggleMutation = useMutation({
    mutationFn: () => favorites.toggle(entityType, entityId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['favorites'] });
    },
  });

  return (
    <button
      onClick={(e) => { e.stopPropagation(); toggleMutation.mutate(); }}
      disabled={toggleMutation.isPending}
      className={cn(
        'rounded-md p-1.5 transition-colors',
        isFavorited
          ? 'text-red-500 hover:bg-red-500/10'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
      aria-label={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
      title={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
    >
      <Heart className={cn('h-3.5 w-3.5', isFavorited && 'fill-current')} />
    </button>
  );
}
