// 字体预加载工具函数

interface FontVariant {
  weight: string;
  style: string;
  file: string;
}

export const preloadFonts = async (): Promise<boolean> => {
  const fontVariants: FontVariant[] = [
    { weight: '400', style: 'normal', file: 'GoogleSansCode-Regular.ttf' },
    { weight: '400', style: 'italic', file: 'GoogleSansCode-Italic.ttf' },
    { weight: '700', style: 'normal', file: 'GoogleSansCode-Bold.ttf' },
    { weight: '700', style: 'italic', file: 'GoogleSansCode-BoldItalic.ttf' },
    { weight: '300', style: 'normal', file: 'GoogleSansCode-Light.ttf' },
    { weight: '300', style: 'italic', file: 'GoogleSansCode-LightItalic.ttf' },
    //{ weight: '500', style: 'normal', file: 'GoogleSansCode-Medium.ttf' },
    //{ weight: '500', style: 'italic', file: 'GoogleSansCode-MediumItalic.ttf' },
    { weight: '600', style: 'normal', file: 'GoogleSansCode-SemiBold.ttf' },
    { weight: '600', style: 'italic', file: 'GoogleSansCode-SemiBoldItalic.ttf' },
    //{ weight: '800', style: 'normal', file: 'GoogleSansCode-ExtraBold.ttf' },
    //{ weight: '800', style: 'italic', file: 'GoogleSansCode-ExtraBoldItalic.ttf' }
  ];

  const fontPromises = fontVariants.map((variant: FontVariant) => {
    return new Promise<void>((resolve, reject) => {
      const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'
      const font = new FontFace('Google Sans Code', `url(${base}${variant.file})`, {
        weight: variant.weight,
        style: variant.style
      });
      
      font.load().then(() => {
        document.fonts.add(font);
        resolve();
      }).catch(reject);
    });
  });

  try {
    await Promise.all(fontPromises);
    return true;
  } catch (error) {
    console.warn('字体预加载失败:', error);
    return false;
  }
};

// 检查字体是否已经加载
export const isFontLoaded = (): boolean => {
  return document.fonts.check('16px "Google Sans Code"');
};

