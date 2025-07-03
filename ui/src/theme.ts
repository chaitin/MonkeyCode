'use client';
import { createTheme, Paper } from '@mui/material';
import type { Shadows } from '@mui/material';
import { zhCN } from '@mui/material/locale';
import { zhCN as CuiZhCN } from '@c-x/ui/dist/local';
import onData from '@/assets/images/nodata.png';
import { common } from '@mui/material/colors';

const defaultTheme = createTheme();

const lightTheme = createTheme(
  {
    cssVariables: true,
    palette: {
      // mode: 'light',
      primary: {
        main: '#21222D',
      },
      error: {
        main: '#F64E54',
      },
      success: {
        main: '#35B37E',
        light: '#AAF27F',
        dark: '#229A16',
        contrastText: '#fff',
      },
      info: {
        main: '#3248F2',
      },
      disabled: {
        main: '#666',
      },
      dark: {
        dark: '#000',
        main: '#14141B',
        light: '#20232A',
        contrastText: '#fff',
      },
      light: {
        main: '#fff',
        contrastText: '#000',
      },
      background: {
        default: '#fff',
        paper: '#F1F2F8',
      },

      text: {
        primary: '#21222D',
        secondary: 'rgba(33,34,45, 0.7)',
        tertiary: 'rgba(33,34,45, 0.5)',
        // @ts-ignore
        auxiliary: 'rgba(33,34,45, 0.5)',
        disabled: 'rgba(33,34,45, 0.2)',
      },
      // divider: '#ECEEF1',
    },
    shadows: [
      ...defaultTheme.shadows.slice(0, 8),
      '0px 10px 20px 0px rgba(54,59,76,0.2)',
      ...defaultTheme.shadows.slice(9),
    ] as Shadows,
    components: {
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundColor: '#fff',
            backgroundImage: 'none',
          },
        },
      },

      MuiInputBase: {
        styleOverrides: {
          root: {
            backgroundColor: '#F8F9FA',
            fontFamily: `var(--font-gilory), var(--font-HarmonyOS), 'PingFang SC',
    'Roboto', 'Helvetica', 'Arial', sans-serif`,
            '.MuiOutlinedInput-notchedOutline': {
              borderColor: 'transparent',
            },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
              borderColor: '#21222D !important',
              borderWidth: '1px !important',
            },
            borderRadius: '10px !important',
          },
        },
      },

      MuiTypography: {
        styleOverrides: {
          root: {
            fontFamily: `var(--font-gilory), var(--font-HarmonyOS), 'PingFang SC',
    'Roboto', 'Helvetica', 'Arial', sans-serif`,
          },
        },
      },
      MuiButtonBase: {
        styleOverrides: {
          root: {
            // lineHeight: '1.5',
            fontFamily: `var(--font-gilory), var(--font-HarmonyOS), 'PingFang SC',
    'Roboto', 'Helvetica', 'Arial', sans-serif`,
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            // lineHeight: '1.5',
            borderRadius: '10px',
            boxShadow: 'none',
            fontFamily: `var(--font-gilory), var(--font-HarmonyOS), 'PingFang SC',
            'Roboto', 'Helvetica', 'Arial', sans-serif`,
          },
        },
      },
      // @ts-ignore
      MuiLoadingButton: {
        styleOverrides: {
          root: {
            lineHeight: '1.5',
            borderRadius: '10px',
          },
        },
      },
      MuiInputLabel: {
        styleOverrides: {
          root: {
            fontSize: 14,
          },
        },
      },
      MuiMenu: {
        styleOverrides: {
          paper: {
            borderRadius: '10px',
          },
        },
      },
      MuiMenuItem: {
        styleOverrides: {
          root: {
            fontFamily: 'var(--font-gilory), var(--font-HarmonyOS)',
            fontSize: '14px',
          },
        },
      },
      MuiAutocomplete: {
        defaultProps: {
          slotProps: {
            paper: {
              elevation: 8,
            },
          },
        },
        styleOverrides: {
          paper: {
            borderRadius: '10px',
          },
          option: {
            fontSize: '14px',
            fontFamily: 'var(--font-gilory), var(--font-HarmonyOS)',
          },
        },
      },
      MuiFormLabel: {
        styleOverrides: {
          root: {
            fontFamily: 'var(--font-gilory), var(--font-HarmonyOS)',
          },
          asterisk: {
            color: '#F64E54',
          },
        },
      },
      MuiLink: {
        styleOverrides: {
          root: {
            textDecoration: 'none',
          },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          root: {
            borderColor: '#eee',
            paddingLeft: '24px !important',
            fontFamily: 'var(--font-gilory), var(--font-HarmonyOS)',
            padding: '25px 12px 26px !important',
            '&:first-of-type': {
              paddingLeft: '16px !important',
            },
          },
          head: {
            paddingTop: '0 !important',
            paddingBottom: '0 !important',
            height: '50px',
            backgroundColor: '#f8f9fa',
            borderBottom: 'none !important',
          },
          body: {
            borderBottom: '1px dashed',
            borderColor: '#ECEEF1',
          },
        },
      },
    },
  },
  zhCN,
  CuiZhCN,
  {
    components: {
      CuiEmpty: {
        defaultProps: {
          image: onData,
          imageStyle: {
            width: '150px',
          },
        },
      },
    },
  }
);

export { lightTheme };
