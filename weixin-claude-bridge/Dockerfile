FROM node:22-alpine

WORKDIR /app

# 安装依赖
COPY package.json package-lock.json ./
RUN npm install

# 复制代码
COPY wechat_bridge.js .
COPY system_prompt.md system_prompt_xaj.md ./

# wechat_sync.json 通过 volume 挂载，不打包进镜像

CMD ["node", "wechat_bridge.js"]
