FROM node:24-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY webpack.config.js tsconfig.json ./
COPY src/ ./src/
COPY public/ ./public/
RUN npm run build



FROM python:3.12-slim
WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY --from=builder /app /app
COPY main.py ./
COPY static/ ./static/



EXPOSE 6600
ENV PORT=6600
ENV VERBOSE=true

CMD ["python3", "main.py"]
