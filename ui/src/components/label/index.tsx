import { styled, alpha } from '@mui/material';

interface StyledLabelProps {
  color?: 'default' | 'success' | 'warning' | 'error' | 'info' | string;
}

const StyledLabel = styled('div')<StyledLabelProps>(
  ({ theme, color = 'default' }) => {
    // 获取颜色值
    const getColor = (colorProp: string) => {
      // 如果是主题预设颜色
      if (
        ['success', 'warning', 'error', 'info', 'disabled'].includes(colorProp)
      ) {
        return theme.palette[
          colorProp as 'success' | 'warning' | 'error' | 'info' | 'disabled'
        ].main;
      }
      // 如果是 default，使用灰色
      if (colorProp === 'default') {
        return theme.palette.grey[500];
      }
      // 如果是自定义颜色字符串
      return colorProp;
    };

    const textColor = getColor(color);

    // 获取背景颜色（淡化版本）
    const getBackgroundColor = (colorProp: string) => {
      if (
        ['success', 'warning', 'error', 'info', 'disabled'].includes(colorProp)
      ) {
        // 使用主题的 light 版本，如果没有则使用 alpha 透明度
        const palette =
          theme.palette[
            colorProp as 'success' | 'warning' | 'error' | 'info' | 'disabled'
          ];
        return alpha(palette.main, 0.15);
      }
      // 如果是 default，使用淡灰色背景
      if (colorProp === 'default') {
        return theme.palette.grey[100];
      }
      // 对于自定义颜色，使用低透明度作为背景
      return alpha(colorProp, 0.15);
    };

    return {
      padding: theme.spacing(0.5, 1),
      borderRadius: (theme.shape.borderRadius as number) * 4,
      color: textColor,
      backgroundColor: getBackgroundColor(color),
      border: `1px solid ${alpha(textColor, 0.3)}`,
      display: 'inline-flex',
      alignItems: 'center',
      fontSize: theme.typography.caption.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
    };
  }
);

export default StyledLabel;
