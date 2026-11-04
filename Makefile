.PHONY: install dev build test typecheck docker-build docker-up docker-down clean

# The docker targets manage the plain-HTTP local stack (docker-compose.yml) and
# nothing else. docker-compose.yml now carries `name: clawd-monitor-local`, so a
# bare `docker compose` in this directory acts on the plain stack and no longer
# matches production: production (docker-compose.traefik.yml, see .relay.yml, no
# project name) runs under the directory name clawd-monitor, and a stack started
# here with a bare `docker compose up -d` before the file got its name runs
# under that directory name too. Stop such a stack once with
# `docker compose -p clawd-monitor down` before the first `make docker-up`, or
# the two compete for port 3000. The -p below matches the file's own name. On
# the server always pass `-f docker-compose.traefik.yml`: a bare command there
# now manages the plain HTTP stack, not production.
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
