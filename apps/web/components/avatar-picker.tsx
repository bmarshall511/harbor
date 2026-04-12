'use client';

/**
 * AvatarPicker — searchable image grid popover for assigning
 * an archive image as a person/pet avatar.
 *
 * Opens as a Radix Popover anchored to the trigger element.
 * The admin searches/browses archive images and clicks one to
 * select it. Supports clearing the current avatar.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as Popover from '@radix-ui/react-popover';
import { Search, X, ImageIcon, Trash2 } from 'lucide-react';
import { cn } from '@/lib/cn';

interface AvatarPickerProps {
  /** Currently selected file ID (null if no avatar set). */
  currentFileId: string | null;
  /** Called when the user picks an image. Pass null to clear. */
  onSelect: (fileId: string | null) => void;
  /** The trigger element (avatar display that opens the picker). */
  children: React.ReactNode;
}

interface ImageFile {
  id: string;
  name: string;
  archiveRootId: string;
  thumbnailUrl: string;
  hasPreview: boolean;
}

export function AvatarPicker({ currentFileId, onSelect, children }: AvatarPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const { data: images, isLoading } = useQuery<ImageFile[]>({
    queryKey: ['avatar-images', search],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search.trim()) params.set('q', search.trim());
      params.set('limit', '48');
      const res = await fetch(`/api/files/images?${params}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: open,
    staleTime: 30_000,
  });

  const handleSelect = (fileId: string | null) => {
    onSelect(fileId);
    setOpen(false);
    setSearch('');
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        {children}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={8}
          className="z-50 w-80 rounded-xl border border-border bg-popover shadow-2xl animate-in fade-in-0 zoom-in-95"
        >
          {/* Header */}
          <div className="border-b border-border p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold">Choose avatar</h3>
              <Popover.Close className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </Popover.Close>
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search images..."
                className="w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-3 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                autoFocus
              />
            </div>
          </div>

          {/* Image grid */}
          <div className="p-2">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            ) : images && images.length > 0 ? (
              <div className="grid grid-cols-4 gap-1.5 max-h-56 overflow-y-auto">
                {images.map((img) => {
                  const isSelected = img.id === currentFileId;
                  return (
                    <button
                      key={img.id}
                      type="button"
                      onClick={() => handleSelect(img.id)}
                      className={cn(
                        'group relative aspect-square overflow-hidden rounded-lg transition-all',
                        'hover:ring-2 hover:ring-primary hover:ring-offset-1 hover:ring-offset-background',
                        isSelected && 'ring-2 ring-primary ring-offset-1 ring-offset-background',
                      )}
                      title={img.name}
                    >
                      <img
                        src={img.thumbnailUrl}
                        alt={img.name}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                      {isSelected && (
                        <div className="absolute inset-0 flex items-center justify-center bg-primary/30">
                          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-white">
                            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          </div>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <ImageIcon className="h-8 w-8 text-muted-foreground/30" />
                <p className="mt-2 text-xs text-muted-foreground">
                  {search ? 'No images match' : 'No images in your archive'}
                </p>
              </div>
            )}
          </div>

          {/* Footer — clear avatar */}
          {currentFileId && (
            <div className="border-t border-border p-2">
              <button
                type="button"
                onClick={() => handleSelect(null)}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 transition"
              >
                <Trash2 className="h-3 w-3" />
                Remove avatar
              </button>
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
