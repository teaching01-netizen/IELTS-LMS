package media

import (
	"encoding/binary"
	"testing"

	"example.com/ielts-proctoring/internal/platform/apperrors"
)

func TestSatImagePolicyContract(t *testing.T) {
	if MaxUploadBytes != 10<<20 {
		t.Fatalf("MaxUploadBytes = %d, want %d", MaxUploadBytes, 10<<20)
	}
	if maxImageDimension != 8192 {
		t.Fatalf("maxImageDimension = %d, want 8192", maxImageDimension)
	}
	if maxDecodedPixels != 25_000_000 {
		t.Fatalf("maxDecodedPixels = %d, want 25000000", maxDecodedPixels)
	}

	for _, contentType := range []string{"image/png", "image/jpeg", "image/webp", "image/gif"} {
		if err := validateImageContentType(contentType); err != nil {
			t.Fatalf("validateImageContentType(%q) returned %v", contentType, err)
		}
	}
}

func TestSatImagePolicyRejectsUnsupportedTypes(t *testing.T) {
	for _, contentType := range []string{"image/svg+xml", "image/avif", "application/pdf", ""} {
		if err := validateImageContentType(contentType); err == nil {
			t.Fatalf("validateImageContentType(%q) accepted unsupported type", contentType)
		}
	}
}

func TestWebPDimensionLimitIsEnforced(t *testing.T) {
	body := webpVP8XHeader(8193, 1)
	if err := validateImageMagic(body, "image/webp"); err != nil {
		t.Fatalf("webp fixture does not pass magic validation: %v", err)
	}
	if err := validateDecodedImageLimits(body, "image/webp"); codeOf(err) != apperrors.CodePayloadTooLarge {
		t.Fatalf("expected PAYLOAD_TOO_LARGE for oversized WebP dimensions, got %v", err)
	}
}

func webpVP8XHeader(width, height uint32) []byte {
	const chunkSize = 10
	const totalSize = 30
	body := make([]byte, totalSize)
	copy(body[0:4], "RIFF")
	binary.LittleEndian.PutUint32(body[4:8], totalSize-8)
	copy(body[8:12], "WEBP")
	copy(body[12:16], "VP8X")
	binary.LittleEndian.PutUint32(body[16:20], chunkSize)
	width--
	height--
	body[24] = byte(width)
	body[25] = byte(width >> 8)
	body[26] = byte(width >> 16)
	body[27] = byte(height)
	body[28] = byte(height >> 8)
	body[29] = byte(height >> 16)
	return body
}
