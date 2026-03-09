import React from 'react';

type IconProps = {
  name: string;
  style?: React.CSSProperties;
  [key: string]: any;
};

function Icon({ name, style = {}, ...props }: IconProps) {
  return (
    <svg style={style} {...props}>
      <use xlinkHref={`#icon-${name}`} />
    </svg>
  );
};


export default Icon;