FROM nginx:alpine

RUN mkdir -p /etc/nginx/locations

COPY --chown=nginx:nginx dist/ /usr/share/nginx/html/
COPY --chown=nginx:nginx nginx.conf /etc/nginx/nginx.conf

USER nginx

EXPOSE 8080

ENTRYPOINT []
CMD ["nginx", "-g", "daemon off;"]
