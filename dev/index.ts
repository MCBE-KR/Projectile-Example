import { Block, Dimension, LocationInUnloadedChunkError, LocationOutOfWorldBoundariesError, Player, system, Vector3, world } from "@minecraft/server";
import { calcVectors } from "./utils/mathUtils";
import { getHitLocations } from "./utils/projectileUtils";

interface IProjectile {
    dimension: Dimension;
    location: Vector3;
    vector: Vector3;
    moveCount: number;
    age: number;
}

const projectiles: IProjectile[] = [];

const spawnProjectile = (player: Player) => {
    const viewVector = player.getViewDirection();
    const { x, y, z } = viewVector;

    const distance = Math.sqrt(x ** 2 + y ** 2 + z ** 2);
    const normalizedVector = {
        x: x / distance,
        y: y / distance,
        z: z / distance,
    };

    const projectile: IProjectile = {
        dimension: player.dimension,
        location: { ...player.getHeadLocation() },
        vector: normalizedVector,
        moveCount: 60,
        age: 0,
    };

    projectiles.push(projectile);
};

world.beforeEvents.playerBreakBlock.subscribe((event) => {
    spawnProjectile(event.player);
});

system.runInterval(() => {
    const deadProjectiles: IProjectile[] = [];
    const blockCache = new Map<string, Block | undefined>();

    const start = Date.now();
    for (const projectile of projectiles) {
        try {
            if (++projectile.age === 20) {
                deadProjectiles.push(projectile);
                continue;
            }

            const { dimension, vector, moveCount } = projectile;
            let location = projectile.location;

            const hitLocations = getHitLocations(
                location,
                calcVectors(location, vector, (value1, value2) => value1 + value2 * moveCount * 0.1),
            );

            let endLocation: Vector3 | null = null;
            for (const hitLocation of hitLocations) {
                dimension.spawnParticle("minecraft:basic_flame_particle", hitLocation);

                const cacheKey = `${Math.floor(hitLocation.x)}_${Math.floor(hitLocation.y)}_${Math.floor(hitLocation.z)}`;
                let block = blockCache.get(cacheKey);
                if (!block) {
                    block = dimension.getBlock(hitLocation);
                    blockCache.set(cacheKey, block);
                }

                if (!block) {
                    console.error("Block is undefined", hitLocation.x, hitLocation.y, hitLocation.z);
                    break;
                }

                // 이게 문제인데, 어떻게 수정할지 고민해야 한다 (BE는 solid 판정이 좀 이상함). 기존처럼 통과 가능한 블록 목록을 수동으로 작성하는 방법을 고려중
                if (!block.isAir || !block.isLiquid) {
                    endLocation = {
                        x: hitLocation.x,
                        y: hitLocation.y,
                        z: hitLocation.z,
                    };

                    break;
                }
            }

            const isXPositive = vector.x >= 0;
            const isYPositive = vector.y >= 0;
            const isZPositive = vector.z >= 0;

            for (let i = 0; i < moveCount; i++) {
                location = calcVectors(location, vector, (value1, value2) => value1 + value2 * 0.1);

                // 블록 히트 검사
                if (
                    endLocation &&
                    location.x >= endLocation.x === isXPositive &&
                    location.y >= endLocation.y === isYPositive &&
                    location.z >= endLocation.z === isZPositive
                ) {
                    deadProjectiles.push(projectile);
                    break;
                }

                dimension.spawnParticle("minecraft:basic_crit_particle", location);
            }

            projectile.location = location;
        } catch (e) {
            if (!(e instanceof LocationOutOfWorldBoundariesError || e instanceof LocationInUnloadedChunkError)) {
                console.error("Projectile Interval", e);
            }

            deadProjectiles.push(projectile);
        }
    }

    for (const deadProjectile of deadProjectiles) {
        const index = projectiles.findIndex((element) => element === deadProjectile);
        projectiles.splice(index, 1);
    }

    const took = Date.now() - start;
    if (took > 1) {
        console.warn(`Took ${Date.now() - start}ms`);
    }
});
