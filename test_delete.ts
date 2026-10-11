import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    where: {
      name: {
        contains: 'hani',
        mode: 'insensitive'
      }
    }
  });
  
  if (users.length === 0) return;
  for (const user of users) {
    const chats = await prisma.chat.findMany({
      where: { userId: user.id }
    });

    console.log(`Found ${chats.length} chats for user ${user.name}`);

    for (const chat of chats) {
      try {
        await prisma.chat.delete({
          where: { id: chat.id }
        });
        console.log(`Deleted chat ${chat.id}`);
      } catch (err) {
        console.error(`Failed to delete chat ${chat.id}:`, err);
      }
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
