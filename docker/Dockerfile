# 直接使用 nginx 镜像，因为应用已经在 CI 中构建完成
FROM nginx:alpine

# 复制构建产物到 nginx 目录
COPY dist/ /usr/share/nginx/html/

COPY nginx.conf /etc/nginx/nginx.conf

# 复制启动脚本
COPY start.sh /start.sh
RUN chmod +x /start.sh

# 暴露端口
EXPOSE 80

# 使用启动脚本启动
CMD ["/start.sh"]
