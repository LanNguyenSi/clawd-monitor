.PHONY: install dev build test typecheck docker-build docker-up docker-down clean

install:
	npm install

dev:
	npm run dev

build:
	npm run build

typecheck:
	npm run typecheck

docker-up:
	docker compose up -d

docker-down:
	docker compose down

docker-build:
	docker build -t clawd-monitor .

clean:
	rm -rf node_modules dist .next
