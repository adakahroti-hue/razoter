import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { hashPassword } from '@/lib/auth';
import { withCors, handleCorsPreflight } from '@/lib/cors';

export async function OPTIONS() {
  return handleCorsPreflight();
}

export async function GET() {
  try {
    // Check existing users
    const { data: users, error: selectError } = await supabase
      .from('users')
      .select('id, username, password_hash, created_at');

    if (selectError) {
      return withCors(
        NextResponse.json({ 
          error: 'Database query failed', 
          details: selectError.message,
          code: selectError.code 
        }, { status: 500 })
      );
    }

    return withCors(
      NextResponse.json({ 
        users_count: users?.length || 0,
        users: (users || []).map(u => ({
          id: u.id,
          username: u.username,
          password_hash_length: u.password_hash?.length || 0,
          password_hash_prefix: u.password_hash?.substring(0, 10) || 'null',
          created_at: u.created_at
        }))
      })
    );
  } catch (error: any) {
    return withCors(
      NextResponse.json({ error: error.message }, { status: 500 })
    );
  }
}

export async function POST() {
  try {
    // Delete existing admin and recreate
    await supabase.from('users').delete().eq('username', 'admin');
    
    const passwordHash = await hashPassword('admin123');
    
    const { data, error } = await supabase
      .from('users')
      .insert({ username: 'admin', password_hash: passwordHash })
      .select('id, username')
      .single();

    if (error) {
      return withCors(
        NextResponse.json({ 
          error: 'Insert failed', 
          details: error.message,
          code: error.code 
        }, { status: 500 })
      );
    }

    return withCors(
      NextResponse.json({ 
        message: 'Admin user recreated',
        user: data,
        hash_length: passwordHash.length,
        hash_prefix: passwordHash.substring(0, 10)
      })
    );
  } catch (error: any) {
    return withCors(
      NextResponse.json({ error: error.message }, { status: 500 })
    );
  }
}
