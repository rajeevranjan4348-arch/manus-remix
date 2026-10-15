import React, { useState } from 'react';
import { 
  Sparkles, 
  Image as ImageIcon, 
  Download, 
  Copy, 
  Send, 
  RefreshCw, 
  X, 
  Check, 
  Wand2, 
  Layers, 
  Maximize2,
  Trash2,
  Sliders
} from 'lucide-react';
import { toast } from 'sonner';

export interface GeneratedImageItem {
  id: string;
  prompt: string;
  imageDataUrl: string;
  mimeType: string;
  provider: string;
  aspectRatio: string;
  stylePreset: string;
  createdAt: number;
}

interface ImageGenerationModeProps {
  onInsertToChat?: (imageDataUrl: string, prompt: string) => void;
  onClose?: () => void;
  isModal?: boolean;
}

const ASPECT_RATIOS = [
  { id: '1:1', label: '1:1 Square', icon: '⏹️', dimensions: '1024 × 1024' },
  { id: '16:9', label: '16:9 Landscape', icon: '🖼️', dimensions: '1344 × 768' },
  { id: '9:16', label: '9:16 Portrait', icon: '📱', dimensions: '768 × 1344' },
  { id: '4:3', label: '4:3 Standard', icon: '📺', dimensions: '1152 × 864' },
  { id: '3:4', label: '3:4 Tall', icon: '📄', dimensions: '864 × 1152' },
];

const STYLE_PRESETS = [
  { id: 'natural', name: 'Natural / Raw', desc: 'Photorealistic & balanced' },
  { id: 'photorealistic', name: 'Photorealistic', desc: 'Ultra-detailed 8K photography' },
  { id: 'cyberpunk', name: 'Cyberpunk', desc: 'Neon lights, futuristic cityscapes' },
  { id: 'anime', name: 'Anime / Manga', desc: 'Vibrant Japanese animation style' },
  { id: 'fantasy', name: 'Epic Fantasy', desc: 'Magical, mythical landscapes' },
  { id: '3d-render', name: '3D Render', desc: 'Octane render, Pixar aesthetic' },
  { id: 'cinematic', name: 'Cinematic', desc: '35mm film grain & dramatic lighting' },
  { id: 'minimalist', name: 'Minimalist Vector', desc: 'Clean shapes, modern design' },
];

const INSPIRATION_PROMPTS = [
  'A cute futuristic robot painting a canvas in a cozy sunlit studio with plants',
  'Cyberpunk neon city alleyway at night with rain puddles reflecting glowing neon signs',
  'Serene floating island with waterfalls cascading into clouds at golden hour sunset',
  'Isometric 3D micro room setup with gaming station, pastel neon lighting, soft shadows',
  'Majestic snow-capped mountain range under a brilliant starry galaxy sky with aurora borealis',
  'Minimalist flat vector illustration of a coffee shop on a quiet European street'
];

export function ImageGenerationMode({ onInsertToChat, onClose, isModal = false }: ImageGenerationModeProps) {
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [selectedStyle, setSelectedStyle] = useState('natural');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStep, setGenerationStep] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedPreviewImage, setSelectedPreviewImage] = useState<GeneratedImageItem | null>(null);

  // Saved image history for the current session
  const [history, setHistory] = useState<GeneratedImageItem[]>(() => {
    try {
      const stored = localStorage.getItem('manus_generated_images');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const saveHistory = (newItems: GeneratedImageItem[]) => {
    setHistory(newItems);
    try {
      localStorage.setItem('manus_generated_images', JSON.stringify(newItems.slice(0, 20)));
    } catch {
      // Ignore quota errors
    }
  };

  const handleEnhancePrompt = () => {
    if (!prompt.trim()) {
      toast.info('Enter a base prompt first to enhance!');
      return;
    }
    const styleObj = STYLE_PRESETS.find(s => s.id === selectedStyle);
    const styleText = styleObj && styleObj.id !== 'natural' ? `, in ${styleObj.name} style` : '';
    const enhanced = `${prompt.trim()}${styleText}, highly detailed, 8k resolution, masterpiece quality, dramatic volumetric lighting, cinematic composition`;
    setPrompt(enhanced);
    toast.success('Prompt enhanced with cinematic & visual detail modifiers!');
  };

  const handleGenerate = async () => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      toast.error('Please enter an image prompt.');
      return;
    }

    setIsGenerating(true);
    setGenerationStep('Formatting prompt & style parameters...');

    try {
      const fullPrompt = selectedStyle !== 'natural'
        ? `${trimmedPrompt} [Style: ${selectedStyle}] [Aspect Ratio: ${aspectRatio}]`
        : `${trimmedPrompt} [Aspect Ratio: ${aspectRatio}]`;

      setGenerationStep('Sending request to Gemini AI Image Engine...');

      const response = await fetch('/api/image-generation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: fullPrompt }),
      });

      setGenerationStep('Processing rendered image pixels...');

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to generate image. Please check API credentials.');
      }

      const newItem: GeneratedImageItem = {
        id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        prompt: trimmedPrompt,
        imageDataUrl: data.imageDataUrl,
        mimeType: data.mimeType || 'image/png',
        provider: data.provider || 'Gemini AI',
        aspectRatio,
        stylePreset: selectedStyle,
        createdAt: Date.now(),
      };

      const updatedHistory = [newItem, ...history];
      saveHistory(updatedHistory);
      setSelectedPreviewImage(newItem);

      toast.success('Image generated successfully!');
    } catch (err: any) {
      toast.error(err.message || 'Image generation failed');
    } finally {
      setIsGenerating(false);
      setGenerationStep('');
    }
  };

  const handleCopyUrl = (item: GeneratedImageItem) => {
    try {
      navigator.clipboard.writeText(item.imageDataUrl);
      setCopiedId(item.id);
      toast.success('Image Data URL copied to clipboard!');
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      toast.error('Failed to copy to clipboard');
    }
  };

  const handleDownload = (item: GeneratedImageItem) => {
    try {
      const link = document.createElement('a');
      link.href = item.imageDataUrl;
      const ext = item.mimeType.includes('png') ? 'png' : item.mimeType.includes('jpeg') ? 'jpg' : 'png';
      link.download = `manus-art-${Date.now()}.${ext}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success('Image download started');
    } catch {
      toast.error('Failed to download image');
    }
  };

  const handleDeleteHistory = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const filtered = history.filter(h => h.id !== id);
    saveHistory(filtered);
    if (selectedPreviewImage?.id === id) {
      setSelectedPreviewImage(filtered[0] || null);
    }
    toast.info('Image removed from session history');
  };

  return (
    <div className="w-full max-w-5xl mx-auto flex flex-col gap-6 text-foreground">
      {/* Header Bar */}
      <div className="flex items-center justify-between pb-4 border-b border-border/60">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-purple-600 via-indigo-600 to-pink-500 flex items-center justify-center text-white shadow-md shadow-purple-500/20">
            <Sparkles size={22} className="animate-pulse" />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
              Manus Studio AI Image Generator
            </h2>
            <p className="text-xs text-muted-foreground">
              Create high-resolution artwork, logos, and illustrations with Gemini AI
            </p>
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        )}
      </div>

      {/* Main Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Generator Controls */}
        <div className="lg:col-span-7 flex flex-col gap-5">
          {/* Prompt Card */}
          <div className="p-4 rounded-2xl bg-card border border-border/80 shadow-xs flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Wand2 size={15} className="text-purple-500" />
                Prompt Description
              </label>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleEnhancePrompt}
                  disabled={!prompt.trim() || isGenerating}
                  className="px-2.5 py-1 text-[11px] font-medium rounded-lg bg-purple-500/10 hover:bg-purple-500/20 text-purple-600 dark:text-purple-400 border border-purple-500/30 transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50"
                  title="Enhance prompt with quality modifiers"
                >
                  <Sparkles size={12} />
                  Magic Enhance
                </button>
                {prompt && (
                  <button
                    onClick={() => setPrompt('')}
                    className="text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            <div className="relative">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe the image you want to create... e.g. 'A futuristic cyberpunk motorcycle speeding through a neon neon-lit Tokyo street in the rain'"
                rows={4}
                className="w-full p-3.5 text-sm rounded-xl bg-background border border-border/80 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 outline-none resize-none placeholder:text-muted-foreground/60 transition-all"
                maxLength={4000}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    void handleGenerate();
                  }
                }}
              />
              <div className="absolute right-3 bottom-3 text-[10px] text-muted-foreground">
                {prompt.length} / 4000
              </div>
            </div>

            {/* Inspiration Prompt Pills */}
            <div className="flex flex-col gap-1.5 pt-1">
              <span className="text-[11px] font-medium text-muted-foreground">Try an inspiration prompt:</span>
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
                {INSPIRATION_PROMPTS.map((insp, i) => (
                  <button
                    key={i}
                    onClick={() => setPrompt(insp)}
                    className="text-[11px] px-2.5 py-1 rounded-lg bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground border border-border/40 transition-all text-left line-clamp-1 cursor-pointer"
                  >
                    ✨ {insp}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Aspect Ratio Selector */}
          <div className="p-4 rounded-2xl bg-card border border-border/80 shadow-xs flex flex-col gap-3">
            <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <Layers size={15} className="text-indigo-500" />
              Aspect Ratio
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {ASPECT_RATIOS.map((ratio) => {
                const isSelected = aspectRatio === ratio.id;
                return (
                  <button
                    key={ratio.id}
                    onClick={() => setAspectRatio(ratio.id)}
                    className={`flex flex-col items-center justify-center p-2.5 rounded-xl border text-center transition-all cursor-pointer ${
                      isSelected
                        ? 'border-purple-500 bg-purple-500/10 text-purple-600 dark:text-purple-300 font-semibold shadow-xs'
                        : 'border-border/60 hover:bg-muted/50 text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <span className="text-base mb-1">{ratio.icon}</span>
                    <span className="text-[11px]">{ratio.id}</span>
                    <span className="text-[9px] text-muted-foreground/80 mt-0.5">{ratio.dimensions}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Style Presets */}
          <div className="p-4 rounded-2xl bg-card border border-border/80 shadow-xs flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Sliders size={15} className="text-pink-500" />
                Style Preset
              </label>
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="text-[11px] text-purple-600 dark:text-purple-400 hover:underline cursor-pointer"
              >
                {showAdvanced ? 'Hide options' : 'Advanced settings'}
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {STYLE_PRESETS.map((preset) => {
                const isSelected = selectedStyle === preset.id;
                return (
                  <button
                    key={preset.id}
                    onClick={() => setSelectedStyle(preset.id)}
                    className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                      isSelected
                        ? 'border-purple-500 bg-purple-500/10 text-purple-600 dark:text-purple-300 font-semibold shadow-xs'
                        : 'border-border/60 hover:bg-muted/50 text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <div className="text-xs truncate">{preset.name}</div>
                    <div className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5">{preset.desc}</div>
                  </button>
                );
              })}
            </div>

            {/* Advanced Negative Prompt Option */}
            {showAdvanced && (
              <div className="pt-2 border-t border-border/50 flex flex-col gap-2 animate-in fade-in duration-200">
                <label className="text-[11px] font-semibold text-muted-foreground">
                  Negative Prompt (Elements to avoid)
                </label>
                <input
                  type="text"
                  value={negativePrompt}
                  onChange={(e) => setNegativePrompt(e.target.value)}
                  placeholder="e.g. blurry, low quality, distorted hands, watermark"
                  className="w-full px-3 py-2 text-xs rounded-lg bg-background border border-border/80 focus:border-purple-500 outline-none"
                />
              </div>
            )}
          </div>

          {/* Action Generate Button */}
          <button
            onClick={() => void handleGenerate()}
            disabled={isGenerating || !prompt.trim()}
            className="w-full py-3.5 px-6 rounded-2xl bg-gradient-to-r from-purple-600 via-indigo-600 to-pink-600 text-white font-semibold text-sm shadow-lg shadow-purple-500/25 hover:shadow-purple-500/40 hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isGenerating ? (
              <>
                <RefreshCw size={18} className="animate-spin" />
                <span>Generating Artwork...</span>
              </>
            ) : (
              <>
                <Sparkles size={18} />
                <span>Generate Image</span>
                <span className="text-xs opacity-75 font-normal ml-1">(Ctrl + Enter)</span>
              </>
            )}
          </button>
        </div>

        {/* Right Column: Preview Showcase & History Gallery */}
        <div className="lg:col-span-5 flex flex-col gap-5">
          {/* Main Preview Card */}
          <div className="p-4 rounded-2xl bg-card border border-border/80 shadow-xs flex flex-col gap-3 min-h-[380px] justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <ImageIcon size={15} className="text-emerald-500" />
                Image Preview
              </span>
              {selectedPreviewImage && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-300 font-medium border border-purple-500/20">
                  {selectedPreviewImage.provider} • {selectedPreviewImage.aspectRatio}
                </span>
              )}
            </div>

            {/* Canvas / Image Display Area */}
            <div className="relative w-full aspect-square rounded-xl bg-slate-900/90 dark:bg-black/60 border border-border/50 overflow-hidden flex items-center justify-center group">
              {isGenerating ? (
                <div className="flex flex-col items-center justify-center p-6 text-center gap-3">
                  <div className="w-16 h-16 rounded-2xl bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-400 animate-pulse">
                    <Sparkles size={32} className="animate-spin" />
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-sm font-semibold text-white">Synthesizing Pixels...</span>
                    <span className="text-xs text-purple-300 animate-pulse">{generationStep}</span>
                  </div>
                </div>
              ) : selectedPreviewImage ? (
                <>
                  <img
                    src={selectedPreviewImage.imageDataUrl}
                    alt={selectedPreviewImage.prompt}
                    className="w-full h-full object-contain bg-black/40 transition-transform duration-300 group-hover:scale-[1.02]"
                  />
                  {/* Hover Overlay Controls */}
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 p-4 backdrop-blur-xs">
                    <button
                      onClick={() => handleDownload(selectedPreviewImage)}
                      className="p-2.5 rounded-xl bg-white/20 hover:bg-white/30 text-white transition-colors cursor-pointer"
                      title="Download PNG"
                    >
                      <Download size={18} />
                    </button>
                    <button
                      onClick={() => handleCopyUrl(selectedPreviewImage)}
                      className="p-2.5 rounded-xl bg-white/20 hover:bg-white/30 text-white transition-colors cursor-pointer"
                      title="Copy Image URL"
                    >
                      {copiedId === selectedPreviewImage.id ? <Check size={18} /> : <Copy size={18} />}
                    </button>
                    {onInsertToChat && (
                      <button
                        onClick={() => {
                          onInsertToChat(selectedPreviewImage.imageDataUrl, selectedPreviewImage.prompt);
                          if (onClose) onClose();
                        }}
                        className="p-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white transition-colors cursor-pointer flex items-center gap-1.5 text-xs font-semibold px-3.5"
                      >
                        <Send size={15} />
                        Use in Chat
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center p-6 text-center text-muted-foreground gap-2">
                  <ImageIcon size={40} className="stroke-1 opacity-40" />
                  <p className="text-xs">No image generated yet.</p>
                  <p className="text-[11px] opacity-70">Enter a prompt and click Generate to see artwork here.</p>
                </div>
              )}
            </div>

            {/* Selected Image Prompt Summary */}
            {selectedPreviewImage && !isGenerating && (
              <div className="flex items-center justify-between pt-2 border-t border-border/50 text-xs">
                <p className="text-muted-foreground line-clamp-1 italic text-[11px]">
                  &quot;{selectedPreviewImage.prompt}&quot;
                </p>
                <div className="flex items-center gap-1 shrink-0 ml-2">
                  <button
                    onClick={() => handleDownload(selectedPreviewImage)}
                    className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    title="Download"
                  >
                    <Download size={14} />
                  </button>
                  {onInsertToChat && (
                    <button
                      onClick={() => {
                        onInsertToChat(selectedPreviewImage.imageDataUrl, selectedPreviewImage.prompt);
                        if (onClose) onClose();
                      }}
                      className="px-2.5 py-1 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-medium text-[11px] transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <Send size={12} />
                      Send to Chat
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* History Gallery */}
          {history.length > 0 && (
            <div className="p-4 rounded-2xl bg-card border border-border/80 shadow-xs flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Maximize2 size={14} className="text-purple-500" />
                  Recent Generations ({history.length})
                </span>
                <button
                  onClick={() => {
                    saveHistory([]);
                    setSelectedPreviewImage(null);
                    toast.info('Cleared image history');
                  }}
                  className="text-[10px] text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
                >
                  Clear History
                </button>
              </div>

              <div className="grid grid-cols-4 gap-2 max-h-36 overflow-y-auto pr-1">
                {history.map((item) => {
                  const isSelected = selectedPreviewImage?.id === item.id;
                  return (
                    <div
                      key={item.id}
                      onClick={() => setSelectedPreviewImage(item)}
                      className={`relative aspect-square rounded-xl overflow-hidden border cursor-pointer group transition-all ${
                        isSelected ? 'ring-2 ring-purple-500 border-purple-500' : 'border-border/60 hover:opacity-90'
                      }`}
                    >
                      <img
                        src={item.imageDataUrl}
                        alt={item.prompt}
                        className="w-full h-full object-cover"
                      />
                      <button
                        onClick={(e) => handleDeleteHistory(item.id, e)}
                        className="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                        title="Delete from history"
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ImageGenerationModal({
  isOpen,
  onClose,
  onInsertToChat,
}: {
  isOpen: boolean;
  onClose: () => void;
  onInsertToChat?: (imageDataUrl: string, prompt: string) => void;
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[110] bg-black/70 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 overflow-y-auto animate-in fade-in duration-200">
      <div className="relative w-full max-w-5xl bg-background border border-border/80 rounded-3xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <ImageGenerationMode
          isModal
          onClose={onClose}
          onInsertToChat={onInsertToChat}
        />
      </div>
    </div>
  );
}
