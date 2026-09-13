import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowDownToLine, ArrowUpRight, Check, Copy, Smartphone, X } from 'lucide-react';
import manifest from '../public/brand/manifest.json';
import './brand-kit.css';

const categories = [
  { id: 'all', label: 'Everything' },
  { id: 'logos', label: 'Logos' },
  { id: 'profiles', label: 'Profile pictures' },
  { id: 'wallpapers', label: 'Wallpapers' },
  { id: 'headers', label: 'Headers' },
  { id: 'social', label: 'Social & ads' },
  { id: 'backgrounds', label: 'Backgrounds' },
] as const;

type Category = (typeof categories)[number]['id'];
type Asset = {
  id: string;
  title: string;
  description: string;
  category: Exclude<Category, 'all'>;
  width: number;
  height: number;
  preview: string;
  png: string;
  svg?: string;
  background: string;
};
type BrandManifest = {
  version: string;
  name: string;
  palette: { name: string; hex: string }[];
  zip: string;
  assets: Asset[];
};

const kit = manifest as BrandManifest;

function filename(path: string) {
  return path.split('/').pop();
}

function AssetLinks({ asset }: { asset: Asset }) {
  return (
    <div className="bk-asset-links">
      <a className="bk-download-link" href={asset.png} download={filename(asset.png)}>
        <ArrowDownToLine size={15} aria-hidden="true" />
        <span>Download PNG</span>
        <span className="bk-sr-only"> — {asset.title}</span>
      </a>
      {asset.svg && (
        <a className="bk-svg-link" href={asset.svg} download={filename(asset.svg)}>
          SVG <span className="bk-sr-only"> — {asset.title}</span>
        </a>
      )}
    </div>
  );
}

export default function BrandKit() {
  const [category, setCategory] = useState<Category>('all');
  const [selected, setSelected] = useState<Asset | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [copyError, setCopyError] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const assets = kit.assets.filter((asset) => category === 'all' || asset.category === category);
  const cover = kit.assets.find((asset) => asset.category === 'profiles') ?? kit.assets[0];

  useEffect(() => {
    if (selected && !dialogRef.current?.open) dialogRef.current?.showModal();
  }, [selected]);

  useEffect(() => () => clearTimeout(copyTimer.current), []);

  function closePreview() {
    dialogRef.current?.close();
    setSelected(null);
    restoreFocus.current?.focus();
  }

  async function copyColor(hex: string) {
    try {
      await navigator.clipboard.writeText(hex);
      setCopied(hex);
      setCopyError(false);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopyError(true);
    }
  }

  return (
    <main id="main" className="brand-kit-page">
      <section className="bk-hero" aria-labelledby="brand-title">
        <div className="bk-hero-copy">
          <p className="bk-eyebrow">
            <span /> THE ALLOWANCE BRAND KIT
          </p>
          <h1 id="brand-title">
            A little mark.
            <br />
            <em>A lot of possibility.</em>
          </h1>
          <p className="bk-hero-description">
            Bring Allowance to your corner of the internet. Profile pictures, wallpapers, headers,
            and social artwork. All here. All ready to save.
          </p>
          <div className="bk-hero-actions">
            <a className="bk-primary-link" href={kit.zip} download={filename(kit.zip)}>
              Download the full kit <ArrowDownToLine size={18} aria-hidden="true" />
            </a>
            <a className="bk-text-link" href="#brand-assets">
              Explore the assets <ArrowDown size={17} aria-hidden="true" />
            </a>
          </div>
          <p className="bk-file-note">PNG + editable SVG · Original Allowance artwork</p>
        </div>
        {cover && (
          <div className="bk-hero-art" aria-hidden="true">
            <div className="bk-art-grid" />
            <div className="bk-art-caption">
              A LITTLE INDEPENDENCE.
              <br />A CLEAR LIMIT.
            </div>
            <div className="bk-art-card" style={{ background: cover.background }}>
              <img src={cover.preview} alt="" width={cover.width} height={cover.height} />
            </div>
            <span className="bk-art-label">
              <span /> Made to stand for something.
            </span>
          </div>
        )}
      </section>

      <aside className="bk-save-note" aria-labelledby="phone-save-title">
        <span className="bk-save-icon">
          <Smartphone size={23} aria-hidden="true" />
        </span>
        <div>
          <h2 id="phone-save-title">Saving to your phone?</h2>
          <p>
            Open an asset, then choose <strong>Open full-size image</strong>. On iPhone, press and
            hold the image and choose Save to Photos or Save Image. On Android, press and hold and
            choose Download image. Button downloads may go to Files, depending on your browser.
          </p>
        </div>
      </aside>

      <section className="bk-library" id="brand-assets" aria-labelledby="library-title">
        <div className="bk-section-heading">
          <div>
            <p className="bk-eyebrow">01 / THE ASSET LIBRARY</p>
            <h2 id="library-title">Your next look starts here.</h2>
          </div>
          <p className="bk-count" aria-live="polite">
            {assets.length} {assets.length === 1 ? 'asset' : 'assets'} · ready to use
          </p>
        </div>
        <div className="bk-filters" role="group" aria-label="Filter brand assets">
          {categories.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={category === item.id}
              onClick={() => setCategory(item.id)}
            >
              {item.label}
              <span>
                {item.id === 'all'
                  ? kit.assets.length
                  : kit.assets.filter((asset) => asset.category === item.id).length}
              </span>
            </button>
          ))}
        </div>
        <div className="bk-grid">
          {assets.map((asset) => (
            <article key={asset.id} className="bk-asset-card" data-category={asset.category}>
              <button
                type="button"
                className="bk-preview-button"
                style={{ backgroundColor: asset.background }}
                aria-label={`Preview ${asset.title}`}
                onClick={(event) => {
                  restoreFocus.current = event.currentTarget;
                  setSelected(asset);
                }}
              >
                <img
                  src={asset.preview}
                  alt={asset.title}
                  width={asset.width}
                  height={asset.height}
                  loading="lazy"
                  decoding="async"
                />
                <span className="bk-preview-affordance">
                  <ArrowUpRight size={19} aria-hidden="true" />
                  <span className="bk-sr-only">Open preview</span>
                </span>
              </button>
              <div className="bk-asset-details">
                <p className="bk-asset-meta">
                  {categories.find((item) => item.id === asset.category)?.label}{' '}
                  <span>
                    {asset.width} × {asset.height}
                  </span>
                </p>
                <h3>{asset.title}</h3>
                <p className="bk-asset-description">{asset.description}</p>
                <AssetLinks asset={asset} />
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="bk-palette-section" aria-labelledby="palette-title">
        <div className="bk-section-heading">
          <div>
            <p className="bk-eyebrow">02 / THE PALETTE</p>
            <h2 id="palette-title">Warm. Clear. A little bold.</h2>
          </div>
          <p className="bk-palette-hint">Tap a color to copy its hex code.</p>
        </div>
        <div className="bk-palette">
          {kit.palette.map((color) => (
            <button
              key={color.hex}
              type="button"
              className="bk-color"
              onClick={() => void copyColor(color.hex)}
              aria-label={`Copy ${color.name} ${color.hex}`}
            >
              <span className="bk-color-swatch" style={{ backgroundColor: color.hex }} />
              <span className="bk-color-name">{color.name}</span>
              <span className="bk-color-hex">
                {color.hex}{' '}
                {copied === color.hex ? (
                  <Check size={14} aria-hidden="true" />
                ) : (
                  <Copy size={13} aria-hidden="true" />
                )}
              </span>
            </button>
          ))}
        </div>
        <p className="bk-copy-status" role="status">
          {copied
            ? `${copied} copied.`
            : copyError
              ? 'Copy is unavailable in this browser. Select the hex code above to copy it manually.'
              : ''}
        </p>
      </section>

      <section className="bk-use-note" aria-labelledby="use-title">
        <span className="bk-use-number">A.</span>
        <div>
          <h2 id="use-title">A little room to breathe.</h2>
          <p>
            Keep the mark in its original proportions and give it clear space. Use the supplied
            light or dark versions for contrast. Social artwork describes the product; it is not
            evidence of a payment or an endorsement by Solana.
          </p>
        </div>
        <a className="bk-text-link" href={kit.zip} download={filename(kit.zip)}>
          Everything in one ZIP <ArrowDownToLine size={17} aria-hidden="true" />
        </a>
      </section>

      <dialog
        ref={dialogRef}
        className="bk-dialog"
        aria-labelledby="asset-preview-title"
        onClose={closePreview}
      >
        {selected && (
          <div className="bk-dialog-inner">
            <div className="bk-dialog-topline">
              <span className="bk-eyebrow">ASSET PREVIEW</span>
              <button
                type="button"
                className="bk-close"
                aria-label="Close asset preview"
                onClick={closePreview}
                autoFocus
              >
                <X size={21} aria-hidden="true" />
              </button>
            </div>
            <div className="bk-dialog-image" style={{ backgroundColor: selected.background }}>
              <img
                src={selected.preview}
                width={selected.width}
                height={selected.height}
                alt={selected.title}
              />
            </div>
            <div className="bk-dialog-details">
              <p className="bk-asset-meta">
                {selected.width} × {selected.height} px · PNG{selected.svg ? ' + SVG' : ''}
              </p>
              <h2 id="asset-preview-title">{selected.title}</h2>
              <p>{selected.description}</p>
              <AssetLinks asset={selected} />
              <a
                className="bk-open-image"
                href={selected.png}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open full-size image <ArrowUpRight size={17} aria-hidden="true" />
                <span className="bk-sr-only"> (opens in a new tab)</span>
              </a>
              <p className="bk-dialog-save-tip">
                On your phone, open the full-size image and press and hold to save it.
              </p>
            </div>
          </div>
        )}
      </dialog>
    </main>
  );
}
