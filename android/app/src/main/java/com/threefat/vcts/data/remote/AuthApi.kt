package com.threefat.vcts.data.remote

import com.threefat.vcts.data.remote.dto.LoginRequest
import com.threefat.vcts.data.remote.dto.LoginResponse
import com.threefat.vcts.data.remote.dto.RefreshRequest
import com.threefat.vcts.data.remote.dto.RefreshResponse
import retrofit2.http.Body
import retrofit2.http.POST

/**
 * Auth endpoints. These are the only routes the app talks to anonymously;
 * everything else requires the access-token interceptor to attach
 * `Authorization: Bearer ...`.
 */
interface AuthApi {
    @POST("/api/auth/login")
    suspend fun login(@Body body: LoginRequest): LoginResponse

    @POST("/api/auth/refresh")
    suspend fun refresh(@Body body: RefreshRequest): RefreshResponse
}
