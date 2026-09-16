package media

import "testing"

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
