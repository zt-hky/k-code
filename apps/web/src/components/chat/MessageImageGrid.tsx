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

export function MessageImageGridView(props: {
  readonly images: ReadonlyArray<ChatImageAttachment>;
  readonly onImageExpand: (preview: ExpandedImagePreview) => void;
  readonly children?: ReactNode;
}) {
  const { images, onImageExpand } = props;
  return (
    <div className="mb-2 grid max-w-[210px] grid-cols-2 gap-2">
      {images.map((image) => (
        <div
          key={image.id}
          className={cn(
            "bg-background/70",
            image.source?.kind === "snap-shot" && image.previewUrl
              ? cn(SNAP_SHOT_ATTACHMENT_FRAME_CLASS, "col-span-2")
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
                className="block size-full transform-gpu object-cover"
              />
            </button>
          ) : (
            <div className="flex min-h-[72px] items-center justify-center px-2 py-3 text-center text-2xs text-muted-foreground/70">
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
