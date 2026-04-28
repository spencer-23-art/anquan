const DEFAULT_TARGET_SIZE = 200 * 1024;

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片读取失败，请换一张照片重试。"));
    img.src = dataUrl;
  });
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(event.target.result);
    reader.onerror = () => reject(new Error("图片读取失败，请换一张照片重试。"));
    reader.readAsDataURL(file);
  });
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality);
  });
}

export async function compressImage(file, options = {}) {
  if (!file || !file.type.startsWith("image/")) {
    return file;
  }

  const targetSize = options.targetSize || DEFAULT_TARGET_SIZE;
  if (file.size <= targetSize) {
    return file;
  }

  const dataUrl = await readAsDataUrl(file);
  const img = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("当前浏览器无法压缩图片，请换用其他浏览器或更小的照片。");
  }

  let bestBlob = null;
  const widthSteps = [1600, 1400, 1200, 1000, 800, 640, 480, 360];
  const qualitySteps = [0.82, 0.72, 0.62, 0.52, 0.42, 0.34, 0.28, 0.22];

  for (const maxWidth of widthSteps) {
    const ratio = Math.min(1, maxWidth / img.width);
    const width = Math.max(1, Math.round(img.width * ratio));
    const height = Math.max(1, Math.round(img.height * ratio));
    canvas.width = width;
    canvas.height = height;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    for (const quality of qualitySteps) {
      const blob = await canvasToBlob(canvas, quality);
      if (!blob) {
        continue;
      }
      if (!bestBlob || blob.size < bestBlob.size) {
        bestBlob = blob;
      }
      if (blob.size <= targetSize) {
        return new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), {
          type: "image/jpeg",
          lastModified: Date.now(),
        });
      }
    }
  }

  if (bestBlob && bestBlob.size < file.size) {
    throw new Error(`照片压缩后仍超过 ${Math.round(targetSize / 1024)}KB，请重新拍摄或裁剪后再上传。`);
  }

  throw new Error(`照片超过 ${Math.round(targetSize / 1024)}KB，且无法压缩，请换一张照片。`);
}
