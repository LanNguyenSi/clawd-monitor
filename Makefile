.PHONY: install dev build test typecheck docker-build docker-up docker-down clean

# The docker targets manage the plain-HTTP local stack (docker-compose.yml) and
# nothing else. They name the file and a fixed project, so they never match the
# production containers. Compose finds a project's containers by project name
# plus service name. Production (docker-compose.traefik.yml, see .relay.yml,
# which sets no project name) runs under the directory name, the default for a
# bare `docker compose`, and uses the same service name "app", so a bare
# `docker compose down` there stops the production container.
COMPOSE_LOCAL := docker compose -p clawd-monitor-local -f docker-compose.yml

install:
	npm install

dev:
	npm run dev

build:
	npm run build

test:
	npm test

typecheck:
	npm run type-check

docker-up:
	$(COMPOSE_LOCAL) up -d

docker-down:
	$(COMPOSE_LOCAL) down

docker-build:
	docker build -t clawd-monitor .

clean:
	rm -rf node_modules dist .next
