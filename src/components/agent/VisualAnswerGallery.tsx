import React, { useEffect, useState, useMemo, memo } from 'react';
import { ExternalLink, ChevronLeft, ChevronRight, Maximize2, X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  detectVisualSubjectQuery,
  fetchVisualAnswerImages,
  VisualAnswerImage,
} from '@/lib/visualAnswerEngine';
import { cn } from '@/lib/utils';

export interface VisualAnswerGalleryProps {
  prompt: string;
  assistantContent?: string;
  previousTurnSubjects?: string[];
  onSubjectDisplayed?: (subjects: string[]) => void;
  className?: string;
}

export const VisualAnswerGallery = memo(function VisualAnswerGallery({
  prompt,
  assistantContent,
  previousTurnSubjects = [],
  onSubjectDisplayed,
  className,
}: VisualAnswerGalleryProps) {
  const [images, setImages] = useState<VisualAnswerImage[]>([]);
  const [failedIds, setFailedIds] = useState<Record<string, boolean>>({});
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const detection = useMemo(
    () => detectVisualSubjectQuery(prompt, assistantContent, previousTurnSubjects),
    [prompt, assistantContent, previousTurnSubjects.join('|')]
  );

  const querySignature = detection.searchQueries.join('|');

  useEffect(() => {
    if (!detection.shouldDisplayImages || detection.searchQueries.length === 0) {
      setImages([]);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    fetchVisualAnswerImages(detection, {
      signal: controller.signal,
      maxImages: 4,
    })
      .then((fetched) => {
        if (cancelled) return;
        if (fetched.length > 0) {
          setImages(fetched);
          onSubjectDisplayed?.(detection.subjects);
        }
      })
      .catch(() => {
        // Fail silently and let text response display normally
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [detection.shouldDisplayImages, detection.primarySubject, querySignature]);

  const visibleImages = useMemo(
    () => images.filter((img) => !failedIds[img.id]).slice(0, 4),
    [images, failedIds]
  );

  if (!detection.shouldDisplayImages || visibleImages.length === 0) {
    return null;
  }

  const activeLightboxImage =
    selectedIndex !== null && visibleImages[selectedIndex]
      ? visibleImages[selectedIndex]
      : null;

  const handlePrev = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (selectedIndex === null) return;
    setSelectedIndex((selectedIndex - 1 + visibleImages.length) % visibleImages.length);
  };

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (selectedIndex === null) return;
    setSelectedIndex((selectedIndex + 1) % visibleImages.length);
  };

  return (
    <>
      <div
        data-testid="visual-answer-gallery"
        data-subject={detection.primarySubject}
        className={cn(
          'w-full max-w-full min-w-0 mb-3 select-none animate-in fade-in duration-200',
          className
        )}
      >
        <div className="flex items-center gap-2 sm:gap-2.5 overflow-x-auto no-scrollbar pb-1 max-w-full">
          {visibleImages.map((img, idx) => (
            <button
              key={img.id}
              type="button"
              onClick={() => setSelectedIndex(idx)}
              className="group/vcard relative shrink-0 w-[114px] h-[146px] sm:w-[138px] sm:h-[172px] rounded-2xl overflow-hidden border border-border/60 bg-muted/30 shadow-xs hover:shadow-md transition-all duration-200 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/40"
              title={img.caption || img.title}
              aria-label={`View larger image of ${img.title}`}
            >
              <img
                src={img.thumbnailUrl || img.url}
                alt={img.caption || img.title}
                loading="lazy"
                onError={() => {
                  setFailedIds((prev) => ({ ...prev, [img.id]: true }));
                }}
                onLoad={(e) => {
                  const el = e.currentTarget;
                  if (el.naturalWidth > 0 && el.naturalWidth < 32) {
                    setFailedIds((prev) => ({ ...prev, [img.id]: true }));
                  }
                }}
                className="w-full h-full object-cover object-top group-hover/vcard:scale-105 transition-transform duration-300"
              />

              {/* Subtle bottom gradient + caption/subject overlay */}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/30 to-transparent p-2 pt-5 flex items-end justify-between gap-1 pointer-events-none">
                <span className="text-[10px] font-medium text-white/95 truncate leading-tight">
                  {detection.isComparison ? img.subject : img.title}
                </span>
                <Maximize2
                  size={11}
                  className="text-white/80 opacity-0 group-hover/vcard:opacity-100 transition-opacity shrink-0"
                />
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Tap-to-Expand Lightbox Modal */}
      <Dialog
        open={selectedIndex !== null && Boolean(activeLightboxImage)}
        onOpenChange={(open) => {
          if (!open) setSelectedIndex(null);
        }}
      >
        <DialogContent className="w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] sm:max-w-2xl max-h-[calc(100dvh-1rem)] p-0 bg-card border-border/80 text-foreground overflow-hidden rounded-2xl sm:rounded-3xl shadow-2xl flex flex-col min-w-0 box-border">
          {activeLightboxImage && (
            <>
              <div className="px-4 py-3 pr-10 border-b border-border/60 flex items-center justify-between gap-2 shrink-0 min-w-0">
                <div className="min-w-0">
                  <DialogTitle className="text-sm sm:text-base font-bold text-foreground truncate">
                    {activeLightboxImage.title}
                  </DialogTitle>
                  <DialogDescription className="text-xs text-muted-foreground truncate">
                    {activeLightboxImage.caption || activeLightboxImage.subject}
                  </DialogDescription>
                </div>
              </div>

              <div className="relative bg-black/90 flex items-center justify-center min-h-[240px] max-h-[65dvh] overflow-hidden p-2 sm:p-4">
                <img
                  src={activeLightboxImage.url || activeLightboxImage.thumbnailUrl}
                  alt={activeLightboxImage.caption || activeLightboxImage.title}
                  className="max-h-[60dvh] w-auto max-w-full object-contain rounded-xl shadow-lg"
                />

                {visibleImages.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={handlePrev}
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/60 hover:bg-black/80 text-white border border-white/15 transition-colors cursor-pointer"
                      aria-label="Previous image"
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <button
                      type="button"
                      onClick={handleNext}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/60 hover:bg-black/80 text-white border border-white/15 transition-colors cursor-colors cursor-pointer"
                      aria-label="Next image"
                    >
                      <ChevronRight size={18} />
                    </button>
                  </>
                )}
              </div>

              <div className="p-3 sm:p-4 border-t border-border/60 bg-muted/20 flex flex-wrap items-center justify-between gap-2 shrink-0 min-w-0">
                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar max-w-full">
                  {visibleImages.map((thumb, idx) => (
                    <button
                      key={thumb.id}
                      type="button"
                      onClick={() => setSelectedIndex(idx)}
                      className={cn(
                        'w-11 h-11 rounded-lg overflow-hidden border-2 transition-all cursor-pointer shrink-0',
                        idx === selectedIndex
                          ? 'border-primary scale-105 shadow-xs'
                          : 'border-transparent opacity-60 hover:opacity-100'
                      )}
                      aria-label={`Select image ${idx + 1}`}
                    >
                      <img
                        src={thumb.thumbnailUrl}
                        alt={thumb.title}
                        className="w-full h-full object-cover object-top"
                      />
                    </button>
                  ))}
                </div>

                {activeLightboxImage.sourceUrl && (
                  <a
                    href={activeLightboxImage.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-secondary text-foreground hover:opacity-90 text-xs font-semibold transition-opacity shrink-0"
                  >
                    <span>Source: {activeLightboxImage.sourceName}</span>
                    <ExternalLink size={12} />
                  </a>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
});
