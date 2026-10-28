import { type EnvironmentId } from "@t3tools/contracts";
import { useState, type ReactNode } from "react";
import { useAssetUrls } from "../../assets/assetUrls";
import {
  createMessageAttachmentPreviewProjector,
  selectMessageImageResources,
} from "../../session-logic";
import { type ChatImageAttachment, type ChatMessage, isImageAttachment } from "../../types";
import { cn } from "~/lib/utils";
import { AttachmentImage } from "../media/AttachmentImage";
import { buildExpandedImagePreview, type ExpandedImagePreview } from "./ExpandedImagePreview";
import {
  SNAP_SHOT_ATTACHMENT_FRAME_CLASS,
  SnapShotAttachmentDetails,
} from "./SnapShotAttachmentDetails";

export function useMessageImagePreviews(
  environmentId: EnvironmentId,
  message: ChatMessage,
): ReadonlyArray<ChatImageAttachment> {
  const resources = selectMessageImageResources(message.attachments);
  const previewUrls = useAssetUrls(environmentId, resources);
  const [projectPreviews] = useState(createMessageAttachmentPreviewProjector);
  const previewUrlsById = new Map(
    resources.flatMap((resource, index) => {
      const url = previewUrls[index];
      return url ? [[resource.attachmentId, url] as const] : [];
    }),
  );
  const withPreviews = projectPreviews(message, (attachment) => previewUrlsById.get(attachment.id));
  return (withPreviews.attachments ?? []).filter(isImageAttachment);
}

// Drawn inside the media so dark screenshots keep an edge on the dark background.
const MEDIA_EDGE_CLASS_NAME =
  "relative after:pointer-events-none after:absolute after:inset-0 after:z-10 after:rounded-[inherit] after:ring-1 after:ring-inset after:ring-black/9 dark:after:ring-white/12";

export function MessageImageGridView(props: {
  readonly images: ReadonlyArray<ChatImageAttachment>;
  readonly onImageExpand: (preview: ExpandedImagePreview) => void;
  readonly children?: ReactNode;
  /** Images or videos sent without words show as media, not as a bubble around them. */
  readonly mediaOnly?: boolean;
  /** A lone image keeps its own shape; a 4:3 crop hides most of a wide screenshot. */
  readonly loneImage?: boolean;
  /** Several images sent without words share one rounded shape, split by hairlines. */
  readonly collage?: boolean;
}) {
  const { images, onImageExpand, mediaOnly = false, loneImage = false, collage = false } = props;
  return (
    <div
      className={cn(
        "grid",
        !mediaOnly
          ? "mb-2 max-w-[210px] grid-cols-2 gap-2"
          : loneImage
            ? "max-w-full"
            : collage
              ? cn(
                  MEDIA_EDGE_CLASS_NAME,
                  "w-80 max-w-full gap-px overflow-hidden rounded-2xl bg-black/9 dark:bg-white/12",
                  images.length === 2
                    ? "auto-rows-[12rem] grid-cols-2"
                    : images.length === 3
                      ? "auto-rows-[calc(6rem-0.5px)] grid-cols-[3fr_2fr]"
                      : "auto-rows-[6rem] grid-cols-2",
                )
              : "w-80 max-w-full grid-cols-2 gap-2",
      )}
    >
      {images.map((image, index) => (
        <div
          key={image.id}
          className={cn(
            "bg-background/70",
            image.source?.kind === "snap-shot" && image.previewUrl
              ? cn(SNAP_SHOT_ATTACHMENT_FRAME_CLASS, "col-span-2")
              : loneImage
                ? cn(MEDIA_EDGE_CLASS_NAME, "overflow-hidden rounded-2xl")
                : collage
                  ? cn(
                      "overflow-hidden bg-background",
                      images.length === 3 && index === 0 && "row-span-2",
                      images.length > 3 &&
                        images.length % 2 === 1 &&
                        index === images.length - 1 &&
                        "col-span-2",
                    )
                  : "aspect-[4/3] overflow-hidden rounded-lg border border-border/80",
          )}
        >
          {image.previewUrl ? (
            <button
              type="button"
              className="block h-full w-full cursor-zoom-in"
              aria-label={`Preview ${image.name}`}
              onClick={() => {
                const preview = buildExpandedImagePreview(images, image.id);
                if (!preview) return;
                onImageExpand(preview);
              }}
            >
              {/* Isolate the thumbnail raster from nearby activity repaints in Chromium. */}
              <AttachmentImage
                name={image.name}
                mimeType={image.mimeType}
                src={image.previewUrl}
                alt={image.name}
                decoding="async"
                loading="lazy"
                className={cn(
                  "block transform-gpu",
                  // A fixed height keeps the row from growing when the image loads.
                  loneImage
                    ? "h-48 w-auto min-w-24 max-w-full object-cover"
                    : "size-full object-cover",
                )}
              />
            </button>
          ) : (
            <div
              className={cn(
                "flex min-h-[72px] items-center justify-center px-2 py-3 text-center text-2xs text-muted-foreground/70",
                loneImage && "h-48 w-64 max-w-full",
                collage && "h-full",
              )}
            >
              {image.name}
            </div>
          )}
          {image.previewUrl && image.source?.kind === "snap-shot" ? (
            <SnapShotAttachmentDetails source={image.source} />
          ) : null}
        </div>
      ))}
      {props.children}
    </div>
  );
}

export function MessageImageGrid(props: {
  readonly environmentId: EnvironmentId;
  readonly message: ChatMessage;
  readonly onImageExpand: (preview: ExpandedImagePreview) => void;
}) {
  const images = useMessageImagePreviews(props.environmentId, props.message);
  if (images.length === 0) return null;
  return <MessageImageGridView images={images} onImageExpand={props.onImageExpand} />;
}
