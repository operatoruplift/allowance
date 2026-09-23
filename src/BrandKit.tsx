import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowDownToLine, ArrowUpRight, Check, Copy, Smartphone, X } from 'lucide-react';
import manifest from './brand-manifest.json';
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
  collection?: string;
};
type BrandManifest = {
  version: string;
  name: string;
  palette: { name: string; hex: string }[];
  zip: string;
  assets: Asset[];
  collections?: { id: string; title: string; description: string; coverId: string }[];
  featured?: string[];
};

const kit = manifest as BrandManifest;
const collectionArt: Record<string, string> = {
  sculpture: '/brand/art/sculpture.jpg',
  'open-sky': '/brand/art/sky.jpg',
  'paper-study': '/brand/art/paper.jpg',
};
const categoryOrder: Exclude<Category, 'all'>[] = [
  'wallpapers',
  'social',
  'headers',
  'profiles',
  'backgrounds',
  'logos',
];
const categoryIntros: Record<Exclude<Category, 'all'>, string> = {
  wallpapers: 'A new view, every time you look.',
  social: 'Ideas with a little more impact.',
  headers: 'Make a first impression that lasts.',
  profiles: 'A small mark. Instantly yours.',
  backgrounds: 'Room for your own ideas.',
  logos: 'The essentials, in their purest form.',
};

function assetUrl(path: string) {
  return `${path}?v=${encodeURIComponent(kit.version)}`;
}

function format(asset: Asset) {
  return asset.width > asset.height * 1.4
    ? 'wide'
    : asset.height > asset.width * 1.4
      ? 'tall'
      : 'square';
}

function filename(path: string) {
  return path.split('/').pop();
}

function AssetLinks({ asset }: { asset: Asset }) {
  return (
    <div className="bk-asset-links">
      <a className="bk-download-link" href={assetUrl(asset.png)} download={filename(asset.png)}>
        <ArrowDownToLine size={15} aria-hidden="true" />
        <span>Download PNG</span>
        <span className="bk-sr-only"> — {asset.title}</span>
      </a>
      {asset.svg && (
        <a className="bk-svg-link" href={assetUrl(asset.svg)} download={filename(asset.svg)}>
          SVG <span className="bk-sr-only"> — {asset.title}</span>
        </a>
      )}
    </div>
  );
}

export default function BrandKit() {
  const [category, setCategory] = useState<Category>('all');
  const [collection, setCollection] = useState<string | null>(null);
  const [selected, setSelected] = useState<Asset | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [copyError, setCopyError] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const assets = kit.assets.filter(
    (asset) =>
      (category === 'all' || asset.category === category) &&
      (!collection || asset.collection === collection)
  );
  const cover = kit.assets.find((asset) => asset.id === 'wallpaper-desktop-red');
  const phoneCover = kit.assets.find((asset) => asset.id === 'wallpaper-phone-red');
  const selectedCollection = kit.collections?.find((item) => item.id === collection);
  const groups = categoryOrder
    .map((id) => ({
      id,
      title: categories.find((item) => item.id === id)!.label,
      assets: assets.filter((asset) => asset.category === id),
    }))
    .filter((group) => group.assets.length > 0);

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
        <div className="bk-hero-topline">
          <p className="bk-eyebrow">
            <span /> ALLOWANCE / BRAND STUDIO
          </p>
          <span className="bk-edition">THE RED COLLECTION · 2026</span>
        </div>
        <div className="bk-hero-heading">
          <h1 id="brand-title">
            A little more
            <br />
            <em>possibility.</em>
          </h1>
          <div className="bk-hero-copy">
            <p className="bk-hero-description">
              Bold forms. Open skies. A world of your own. Make Allowance yours with a collection of
              wallpapers, social artwork, and everyday essentials.
            </p>
            <div className="bk-hero-actions">
              <a className="bk-primary-link" href={assetUrl(kit.zip)} download={filename(kit.zip)}>
                Download the full kit <ArrowDownToLine size={18} aria-hidden="true" />
              </a>
              <a className="bk-text-link" href="#brand-assets">
                Find your next look <ArrowDown size={17} aria-hidden="true" />
              </a>
            </div>
            <p className="bk-file-note">
              {kit.assets.length} original assets · High-resolution PNG + SVG
            </p>
          </div>
        </div>
        {cover && (
          <div className="bk-hero-art" aria-hidden="true">
            <img
              className="bk-hero-scene"
              src={assetUrl('/brand/art/sky.jpg')}
              alt=""
              width={cover.width}
              height={cover.height}
            />
            <div className="bk-hero-art-caption">
              <span>ALLOWANCE, EVERYWHERE.</span>
              <span>ARTWORK / EDITION 03</span>
            </div>
            {phoneCover && (
              <div className="bk-hero-phone">
                <img
                  src={assetUrl(phoneCover.preview)}
                  alt=""
                  width={phoneCover.width}
                  height={phoneCover.height}
                />
              </div>
            )}
            <div className="bk-hero-art-footer">
              <span>
                A clear boundary.
                <br />
                An open world.
              </span>
              <ArrowUpRight size={30} />
            </div>
          </div>
        )}
      </section>

      {kit.collections && kit.collections.length > 0 && (
        <section className="bk-collections" aria-labelledby="collections-title">
          <div className="bk-section-heading">
            <div>
              <p className="bk-eyebrow">01 / THREE WAYS TO MAKE IT YOURS</p>
              <h2 id="collections-title">Pick a world.</h2>
            </div>
            <p className="bk-section-aside">One identity. Different points of view.</p>
          </div>
          <div className="bk-collection-grid">
            {kit.collections.map((item, index) => {
              const art = kit.assets.find((asset) => asset.id === item.coverId);
              if (!art) return null;
              return (
                <a
                  key={item.id}
                  className="bk-collection"
                  href="#brand-assets"
                  onClick={() => {
                    setCategory('all');
                    setCollection(item.id);
                  }}
                  aria-label={`Explore ${item.title} collection`}
                  aria-current={collection === item.id ? 'true' : undefined}
                >
                  <div
                    className="bk-collection-art"
                    data-collection={item.id}
                    style={{ background: art.background }}
                  >
                    <img
                      src={assetUrl(collectionArt[item.id] ?? art.preview)}
                      width={art.width}
                      height={art.height}
                      alt=""
                      loading="lazy"
                    />
                    <span className="bk-collection-number">0{index + 1}</span>
                    <span className="bk-collection-arrow">
                      <ArrowUpRight size={23} aria-hidden="true" />
                    </span>
                  </div>
                  <div className="bk-collection-caption">
                    <h3>{item.title}</h3>
                    <p>{item.description}</p>
                  </div>
                </a>
              );
            })}
          </div>
        </section>
      )}

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
            <p className="bk-eyebrow">02 / YOUR EVERYDAY COLLECTION</p>
            <h2 id="library-title">{selectedCollection?.title ?? 'Find your next look.'}</h2>
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
              aria-pressed={category === item.id && !collection}
              onClick={() => {
                setCategory(item.id);
                setCollection(null);
              }}
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
        {selectedCollection && (
          <div className="bk-active-collection">
            <span>{selectedCollection.description}</span>
            <button type="button" onClick={() => setCollection(null)}>
              Show all collections <X size={14} aria-hidden="true" />
            </button>
          </div>
        )}
        {groups.map((group) => (
          <section
            key={group.id}
            className="bk-asset-group"
            aria-labelledby={`bk-group-${group.id}`}
          >
            <div className="bk-group-heading">
              <h3 id={`bk-group-${group.id}`}>{group.title}</h3>
              <p>{categoryIntros[group.id]}</p>
            </div>
            <div className="bk-grid" data-group={group.id}>
              {group.assets.map((asset) => (
                <article
                  key={asset.id}
                  className="bk-asset-card"
                  data-category={asset.category}
                  data-format={format(asset)}
                >
                  <button
                    type="button"
                    className="bk-preview-button"
                    style={{
                      backgroundColor: asset.background,
                      aspectRatio:
                        asset.category === 'logos' ? '1.35' : `${asset.width} / ${asset.height}`,
                    }}
                    aria-label={`Preview ${asset.title}`}
                    onClick={(event) => {
                      restoreFocus.current = event.currentTarget;
                      setSelected(asset);
                    }}
                  >
                    <img
                      src={assetUrl(asset.preview)}
                      alt={asset.title}
                      width={asset.width}
                      height={asset.height}
                      loading="lazy"
                      decoding="async"
                    />
                    <span className="bk-preview-affordance">
                      <span>Take a closer look</span>
                      <ArrowUpRight size={18} aria-hidden="true" />
                    </span>
                  </button>
                  <div className="bk-asset-details">
                    <p className="bk-asset-meta">
                      <span>
                        {asset.width} × {asset.height}
                      </span>
                      <span>PNG{asset.svg ? ' + SVG' : ''}</span>
                    </p>
                    <h4>{asset.title}</h4>
                    <p className="bk-asset-description">{asset.description}</p>
                    <AssetLinks asset={asset} />
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </section>

      <section className="bk-palette-section" aria-labelledby="palette-title">
        <div className="bk-section-heading">
          <div>
            <p className="bk-eyebrow">03 / THE PALETTE</p>
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
        <a className="bk-text-link" href={assetUrl(kit.zip)} download={filename(kit.zip)}>
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
                src={assetUrl(selected.preview)}
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
                href={assetUrl(selected.png)}
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
