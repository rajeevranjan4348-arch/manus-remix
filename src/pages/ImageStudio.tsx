import React, { useRef, useState } from 'react';
import { Download, Image as ImageIcon, LoaderCircle, Sparkles, Upload, WandSparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { compressImageForAI } from '@/lib/fileValidation';
import { getFirebaseAuthorizationHeader } from '@/lib/firebaseAuthorization';

interface GeneratedImage {
  id: string;
  imageDataUrl: string;
  mimeType: string;
  alt: string;
  prompt: string;
  createdAt: number;
}

interface ReferenceImage {
  imageDataUrl: string;
  fileName: string;
}

interface ImageGenerationResponse {
  success?: boolean;
  provider?: string;
  model?: string;
  requestedCount?: number;
  images?: Array<{ imageDataUrl: string; mimeType: string; alt: string }>;
  warning?: string;
  error?: string;
  code?: string;
}

const ASPECT_RATIOS = [
  { value: '1:1', label: 'Square · 1:1' },
  { value: '3:2', label: 'Landscape · 3:2' },
  { value: '16:9', label: 'Wide · 16:9' },
  { value: '21:9', label: 'Cinematic · 21:9' },
  { value: '4:3', label: 'Classic · 4:3' },
  { value: '2:3', label: 'Portrait · 2:3' },
  { value: '3:4', label: 'Portrait · 3:4' },
  { value: '4:5', label: 'Social · 4:5' },
  { value: '5:4', label: 'Landscape · 5:4' },
  { value: '9:16', label: 'Story · 9:16' },
] as const;

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function imageExtension(mimeType: string): string {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  return 'png';
}

export function ImageStudio() {
  const [prompt, setPrompt] = useState('');
  const [reference, setReference] = useState<ReferenceImage | null>(null);
  const [count, setCount] = useState(1);
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPreparingImage, setIsPreparingImage] = useState(false);
  const [requestWarning, setRequestWarning] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleReferenceSelection = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      toast.error('Choose a PNG, JPEG, or WebP image.');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error('Choose an image under 10 MB. It will be compressed before upload.');
      return;
    }

    setIsPreparingImage(true);
    try {
      const imageDataUrl = await compressImageForAI(file, 1024, 0.82);
      if (!imageDataUrl.startsWith('data:image/jpeg;base64,')) {
        throw new Error('The selected image could not be prepared. Try another image.');
      }
      setReference({ imageDataUrl, fileName: file.name.slice(0, 120) || 'Reference image' });
      setRequestWarning('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not prepare that image.');
    } finally {
      setIsPreparingImage(false);
    }
  };

  const handleUseForEdit = (image: GeneratedImage) => {
    setReference({ imageDataUrl: image.imageDataUrl, fileName: 'Generated image' });
    setPrompt('Create a refined variation of this image while keeping the main subject recognizable.');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    toast.success('Image added as an edit reference. Adjust the prompt and generate.');
  };

  const handleGenerate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isGenerating || isPreparingImage || !prompt.trim()) return;

    setIsGenerating(true);
    setRequestWarning('');
    try {
      const authorization = await getFirebaseAuthorizationHeader();
      if (!authorization) {
        throw new Error('The secure guest session is not ready. Refresh the page and try again.');
      }

      const response = await fetch('/api/image-generation', {
        method: 'POST',
        headers: {
          Authorization: authorization,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: prompt.trim(),
          count,
          aspectRatio,
          ...(reference ? { imageDataUrl: reference.imageDataUrl } : {}),
        }),
      });

      let result: ImageGenerationResponse;
      try {
        result = await response.json();
      } catch {
        throw new Error('The image service returned an unreadable response. Please retry.');
      }
      if (!response.ok || !result.success || !Array.isArray(result.images) || result.images.length === 0) {
        throw new Error(result.error || `Image generation failed (HTTP ${response.status}).`);
      }

      const createdAt = Date.now();
      const newImages = result.images.map((image, index) => ({
        id: `${createdAt}-${index}-${Math.random().toString(36).slice(2, 8)}`,
        imageDataUrl: image.imageDataUrl,
        mimeType: image.mimeType,
        alt: image.alt || prompt.trim().slice(0, 180),
        prompt: prompt.trim(),
        createdAt,
      }));
      setImages((current) => [...newImages, ...current]);
      if (result.warning) {
        setRequestWarning(result.warning);
        toast.warning(result.warning);
      } else {
        toast.success(newImages.length === 1 ? 'Image created.' : `${newImages.length} images created.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Image generation failed. Please retry.';
      setRequestWarning(message);
      toast.error(message);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="h-full w-full overflow-y-auto bg-background text-foreground">
      <div className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        <header className="mb-6 flex flex-col gap-2 sm:mb-8">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <ImageIcon size={15} />
            <span>Creative tools</span>
          </div>
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Image Studio</h1>
              <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
                Create images from a prompt or upload a reference to edit it. Make up to four 1K variations together.
              </p>
            </div>
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">
              <Sparkles size={14} className="text-primary" />
              <span>Fast Gemini image model</span>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(300px,370px)_minmax(0,1fr)] lg:gap-6">
          <section className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
            <form onSubmit={handleGenerate} className="space-y-5">
              <div>
                <label htmlFor="image-prompt" className="mb-2 block text-sm font-medium">Describe your image</label>
                <textarea
                  id="image-prompt"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  maxLength={4000}
                  rows={6}
                  placeholder="A tiny astronaut tending a rooftop garden at sunrise, soft film grain, warm colors…"
                  className="min-h-36 w-full resize-y rounded-xl border border-input bg-background px-3.5 py-3 text-sm leading-6 outline-none transition placeholder:text-muted-foreground/65 focus-visible:ring-2 focus-visible:ring-ring"
                  required
                  aria-describedby="image-prompt-hint"
                />
                <div id="image-prompt-hint" className="mt-1.5 flex justify-between gap-3 text-[11px] text-muted-foreground">
                  <span>Be specific about subject, style, lighting, and mood.</span>
                  <span className="shrink-0 tabular-nums">{prompt.length}/4000</span>
                </div>
              </div>

              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleReferenceSelection}
                  className="sr-only"
                  aria-label="Choose a reference image"
                />
                {reference ? (
                  <div className="flex items-center gap-3 rounded-xl border border-border bg-background p-2.5">
                    <img src={reference.imageDataUrl} alt="Selected reference" className="h-14 w-14 rounded-lg object-cover" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium">Edit reference</p>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{reference.fileName}</p>
                    </div>
                    <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => setReference(null)} aria-label="Remove reference image">
                      <X size={16} />
                    </Button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isPreparingImage || isGenerating}
                    className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-background px-3 py-3 text-sm text-muted-foreground transition hover:border-foreground/40 hover:text-foreground disabled:cursor-wait disabled:opacity-60"
                  >
                    {isPreparingImage ? <LoaderCircle size={16} className="animate-spin" /> : <Upload size={16} />}
                    <span>{isPreparingImage ? 'Preparing image…' : 'Add image to edit'}</span>
                  </button>
                )}
                <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">Optional · PNG, JPEG, or WebP · compressed before upload</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="image-count" className="mb-1.5 block text-xs font-medium">Variations</label>
                  <select
                    id="image-count"
                    value={count}
                    onChange={(event) => setCount(Number(event.target.value))}
                    className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value={1}>1 image</option>
                    <option value={2}>2 images</option>
                    <option value={4}>4 images</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="image-aspect-ratio" className="mb-1.5 block text-xs font-medium">Aspect ratio</label>
                  <select
                    id="image-aspect-ratio"
                    value={aspectRatio}
                    onChange={(event) => setAspectRatio(event.target.value)}
                    className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {ASPECT_RATIOS.map((ratio) => <option key={ratio.value} value={ratio.value}>{ratio.label}</option>)}
                  </select>
                </div>
              </div>

              <Button type="submit" disabled={!prompt.trim() || isGenerating || isPreparingImage} className="h-11 w-full rounded-xl">
                {isGenerating ? <LoaderCircle size={17} className="mr-2 animate-spin" /> : reference ? <WandSparkles size={17} className="mr-2" /> : <Sparkles size={17} className="mr-2" />}
                {isGenerating ? `Creating ${count === 1 ? 'image' : `${count} images`}…` : reference ? 'Generate edit' : 'Generate images'}
              </Button>
              <p className="text-center text-[11px] leading-4 text-muted-foreground">Images are generated by the server-side Gemini provider and remain in this page session until you download them.</p>
            </form>
          </section>

          <section aria-label="Generated images" className="min-w-0">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">Results{images.length > 0 ? ` · ${images.length}` : ''}</h2>
              {images.length > 0 && (
                <button type="button" onClick={() => setImages([])} className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                  Clear results
                </button>
              )}
            </div>
            {requestWarning && (
              <div role="status" className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3.5 py-3 text-sm text-amber-800 dark:text-amber-200">
                {requestWarning}
              </div>
            )}
            {images.length === 0 ? (
              <div className="flex min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 px-6 py-10 text-center sm:min-h-[420px]">
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                  <ImageIcon size={26} strokeWidth={1.7} />
                </div>
                <p className="text-sm font-medium">Your images will appear here</p>
                <p className="mt-1.5 max-w-sm text-xs leading-5 text-muted-foreground">
                  Write a prompt to create new artwork, or add a reference image and describe the changes you want.
                </p>
                {isGenerating && (
                  <div className="mt-5 inline-flex items-center gap-2 text-xs text-muted-foreground" role="status">
                    <LoaderCircle size={14} className="animate-spin" /> Generating with Gemini…
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {images.map((image) => (
                  <article key={image.id} className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                    <div className="relative bg-muted/40">
                      <img src={image.imageDataUrl} alt={image.alt} loading="lazy" className="block h-auto max-h-[520px] w-full object-contain" />
                    </div>
                    <div className="space-y-3 p-3.5">
                      <p className="line-clamp-2 min-h-9 text-xs leading-4 text-muted-foreground" title={image.prompt}>{image.prompt}</p>
                      <div className="flex items-center gap-2">
                        <a
                          href={image.imageDataUrl}
                          download={`generated-image-${image.id}.${imageExtension(image.mimeType)}`}
                          className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium transition hover:bg-muted"
                        >
                          <Download size={14} /> Download
                        </a>
                        <Button type="button" variant="outline" size="sm" className="h-9 flex-1 rounded-lg px-2 text-xs" onClick={() => handleUseForEdit(image)}>
                          <WandSparkles size={14} className="mr-1.5" /> Use for edit
                        </Button>
                      </div>
                      <p className="text-[10px] text-muted-foreground">{new Date(image.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
